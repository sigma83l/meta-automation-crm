import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiMode } from "@/src/modules/ai/contracts";
import {
  buildClassificationSystemPrompt,
  buildClassificationUserPrompt,
  buildSystemPrompt,
  buildUserPrompt
} from "@/src/modules/ai/prompt";
import {
  buildReplyInput,
  type ModelCallRecord,
  type TurnContext
} from "@/src/modules/rcos/ai-turn-ports";
import { runTurn, type TurnEvent, type TurnRecord } from "@/src/modules/rcos/turn-engine";
import {
  PROFILE_COLUMNS,
  createTurnRuntime,
  loadTurnContext,
  providersForWorkspace,
  type ProfileRow,
  type TurnRuntimeOverrides
} from "@/src/modules/rcos/turn-runtime";
import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import type { LabRunRequest } from "../contracts";

/** Names the lab's own rows so they are obvious in the CRM and the inbox. */
const SYNTHETIC_CUSTOMER_NAME = "AI Lab (synthetic)";

export type LabResult = Readonly<{
  mode: "prompt" | "pipeline";
  /** Exactly what the model was sent, override included. */
  prompts: Readonly<{
    system: string;
    user: string;
    classificationSystem: string;
    classificationUser: string;
  }>;
  /** Which model answered in which role, and what it cost. */
  calls: readonly ModelCallRecord[];
  classification?: unknown;
  reply?: unknown;
  failure?: Readonly<{ code: string; kind?: string }>;
  record?: TurnRecord;
  draft?: Readonly<{ text: string; citedRefs: readonly string[] }>;
  conversationId?: string;
  /** The context the run actually used, after overrides. */
  context: TurnContext;
}>;

/**
 * Both halves of a provider failure, not just the code.
 *
 * `PROVIDER_UNAVAILABLE` covers a wrong model name, a network fault and an
 * empty completion alike, and those have three different fixes. The kind is
 * what separates them, and the pipeline path already records it - prompt mode
 * reporting only the code would be the less informative of the two modes about
 * the thing it exists to diagnose.
 */
function failureOf(error: Readonly<{ code: string; details?: Readonly<Record<string, unknown>> }>) {
  return {
    failureCode: error.code,
    ...(typeof error.details?.kind === "string" ? { failureKind: error.details.kind } : {})
  };
}

/**
 * Applies the form's overrides to what the workspace really has.
 *
 * Ids are minted here rather than accepted from the request because the
 * citation filter in the provider drops any id the turn did not offer: an item
 * typed into the lab has to be offered under an id the same run generated, or
 * the model can cite it and the citation is silently thrown away.
 */
function applyOverrides(request: LabRunRequest, loaded: TurnContext): TurnContext {
  return {
    ...loaded,
    ...(request.policy ? { policy: request.policy } : {}),
    ...(request.faqItems
      ? { faqItems: request.faqItems.map((item) => ({ id: randomUUID(), ...item })) }
      : {}),
    ...(request.priceItems
      ? { priceItems: request.priceItems.map((item) => ({ id: randomUUID(), ...item })) }
      : {}),
    ...(request.knownFacts ? { knownFacts: request.knownFacts } : {})
  };
}

/**
 * Drops the roles the form left blank.
 *
 * `exactOptionalPropertyTypes` is on, so a key present and undefined is not the
 * same as an absent key - and here the difference is load-bearing: an absent
 * role falls back to the configured `AI_MODEL_*`, while a present-but-undefined
 * one would mean "no model for this role" and resolve to a handoff.
 */
function definedModels(models: LabRunRequest["models"]) {
  return {
    ...(models.utility ? { utility: models.utility } : {}),
    ...(models.primary ? { primary: models.primary } : {}),
    ...(models.escalation ? { escalation: models.escalation } : {})
  };
}

async function readProfile(
  admin: SupabaseClient,
  workspaceId: string
): Promise<ProfileRow | undefined> {
  const { data } = await admin
    .from("business_profiles")
    .select(PROFILE_COLUMNS)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return (data as ProfileRow | null) ?? undefined;
}

/**
 * The lab's own customer and conversation.
 *
 * One per workspace, reused across runs so a conversation builds up the way a
 * real one does - the transcript and the remembered facts are most of what
 * makes the second turn different from the first, and a fresh conversation
 * every run would hide exactly that.
 */
async function ensureSubject(
  admin: SupabaseClient,
  workspace: TrustedWorkspace,
  freshConversation: boolean
): Promise<Readonly<{ customerId: string; conversationId: string }>> {
  const existing = await admin
    .from("customers")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("display_name", SYNTHETIC_CUSTOMER_NAME)
    .maybeSingle();

  const customerId =
    (existing.data?.id as string | undefined) ??
    (
      await admin
        .from("customers")
        .insert({
          workspace_id: workspace.id,
          display_name: SYNTHETIC_CUSTOMER_NAME,
          source: "ai_lab",
          created_by: workspace.userId
        })
        .select("id")
        .single()
        .then((result) => {
          if (result.error) throw new Error("LAB_CUSTOMER_FAILED");
          return result.data;
        })
    ).id;

  if (!freshConversation) {
    const open = await admin
      .from("conversations")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (open.data?.id) return { customerId, conversationId: open.data.id as string };
  }

  const created = await admin
    .from("conversations")
    .insert({ workspace_id: workspace.id, customer_id: customerId, channel: "whatsapp" })
    .select("id")
    .single();
  if (created.error) throw new Error("LAB_CONVERSATION_FAILED");
  return { customerId, conversationId: created.data.id as string };
}

/**
 * Calls the model and shows what it said, with nothing in between.
 *
 * No router, no validator, no policy - which is the point of having it, and
 * also the reason it cannot answer "would this have been sent". It answers the
 * cheaper question the pipeline makes slow: does this wording, on this model,
 * with these approved facts, produce the reply you wanted.
 */
async function runPromptMode(
  admin: SupabaseClient,
  workspace: TrustedWorkspace,
  request: LabRunRequest,
  profile: ProfileRow
): Promise<LabResult> {
  const conversationId = randomUUID();
  const event: TurnEvent = {
    eventId: randomUUID(),
    workspaceId: workspace.id,
    conversationId,
    channel: "whatsapp",
    text: request.message,
    occurredAt: new Date().toISOString()
  };

  // Loaded against a customer id that matches nothing, so remembered facts come
  // only from the form. Prompt mode is for trying wordings, and a fact left
  // over from an earlier pipeline run would change the answer invisibly.
  const loaded = await loadTurnContext(admin, event, profile, randomUUID());
  const context: TurnContext = {
    ...applyOverrides(request, loaded),
    messages: [...request.history, { role: "customer" as const, content: request.message }]
  };
  const input = buildReplyInput(event, context);

  const providers = await providersForWorkspace(admin, workspace.id, profile.ai_mode as AiMode, {
    models: definedModels(request.models),
    ...(request.systemPrompt ? { systemPrompt: request.systemPrompt } : {})
  });

  const prompts = {
    system: request.systemPrompt ?? buildSystemPrompt(input),
    user: buildUserPrompt(input),
    classificationSystem: buildClassificationSystemPrompt(input),
    classificationUser: buildClassificationUserPrompt(input)
  };

  const calls: ModelCallRecord[] = [];
  const base = { mode: "prompt" as const, prompts, context, calls };

  if (!providers.primary) {
    return {
      ...base,
      failure: { code: "NO_PRIMARY_PROVIDER", kind: "unconfigured" }
    };
  }

  const classified = providers.utility ? await providers.utility.classifyTurn(input) : undefined;
  if (classified) {
    calls.push({
      role: "utility",
      task: "classification",
      model: request.models.utility ?? "",
      outcome: classified.ok ? "ok" : "failed",
      ...(classified.ok ? {} : failureOf(classified.error)),
      usage: providers.utility?.getUsageMetadata() ?? null
    });
  }

  const generated = await providers.primary.generateStructuredReply(input);
  calls.push({
    role: "primary",
    task: "reply",
    model: request.models.primary ?? "",
    outcome: generated.ok ? "ok" : "failed",
    ...(generated.ok ? {} : failureOf(generated.error)),
    ...(generated.ok && generated.value.needsHuman ? { deferredToHuman: true } : {}),
    usage: providers.primary.getUsageMetadata()
  });

  return {
    ...base,
    ...(classified?.ok ? { classification: classified.value } : {}),
    ...(generated.ok
      ? { reply: generated.value }
      : {
          failure: {
            code: generated.error.code,
            ...(typeof generated.error.details?.kind === "string"
              ? { kind: generated.error.details.kind }
              : {})
          }
        })
  };
}

/**
 * Runs the real turn, on a real conversation, through the real ports.
 *
 * The message is inserted first because that is what the webhook does: the
 * transcript a turn reads is the stored one, so a turn run against a message
 * that was never stored would see a conversation that does not contain what
 * the customer just said.
 */
async function runPipelineMode(
  admin: SupabaseClient,
  workspace: TrustedWorkspace,
  request: LabRunRequest,
  profile: ProfileRow
): Promise<LabResult> {
  const { customerId, conversationId } = await ensureSubject(
    admin,
    workspace,
    request.freshConversation
  );

  const inbound = await admin.from("messages").insert({
    workspace_id: workspace.id,
    conversation_id: conversationId,
    customer_id: customerId,
    direction: "inbound",
    status: "received",
    body: request.message,
    provider_message_id: `ai-lab:${randomUUID()}`
  });
  if (inbound.error) throw new Error("LAB_INBOUND_FAILED");

  const event: TurnEvent = {
    eventId: randomUUID(),
    workspaceId: workspace.id,
    conversationId,
    channel: "whatsapp",
    text: request.message,
    occurredAt: new Date().toISOString()
  };

  const calls: ModelCallRecord[] = [];
  let draft: Readonly<{ text: string; citedRefs: readonly string[] }> | undefined;
  let context: TurnContext | undefined;

  const overrides: TurnRuntimeOverrides = {
    models: definedModels(request.models),
    ...(request.systemPrompt ? { systemPrompt: request.systemPrompt } : {}),
    context: (loaded) => {
      context = applyOverrides(request, loaded);
      return context;
    },
    onCall: (record) => void calls.push(record),
    onDraft: (reply) => void (draft = { text: reply.text, citedRefs: reply.citedRefs })
  };

  const runtime = await createTurnRuntime(
    admin,
    event,
    { customerId, recipientRef: "ai-lab-synthetic", connectionMode: "sandbox" },
    overrides
  );
  if (!runtime) throw new Error("LAB_NO_BUSINESS_PROFILE");

  const record = await runTurn(event, runtime.ports);
  const used = context ?? (await loadTurnContext(admin, event, profile, customerId));
  const input = buildReplyInput(event, used);

  return {
    mode: "pipeline",
    prompts: {
      system: request.systemPrompt ?? buildSystemPrompt(input),
      user: buildUserPrompt(input),
      classificationSystem: buildClassificationSystemPrompt(input),
      classificationUser: buildClassificationUserPrompt(input)
    },
    calls,
    record,
    ...(draft ? { draft } : {}),
    conversationId,
    context: used
  };
}

export async function runLabTurn(
  admin: SupabaseClient,
  workspace: TrustedWorkspace,
  request: LabRunRequest
): Promise<LabResult> {
  const profile = await readProfile(admin, workspace.id);
  if (!profile) throw new Error("LAB_NO_BUSINESS_PROFILE");
  return request.mode === "prompt"
    ? runPromptMode(admin, workspace, request, profile)
    : runPipelineMode(admin, workspace, request, profile);
}

/** What the console shows as the starting point: the workspace's real setup. */
export async function loadLabDefaults(admin: SupabaseClient, workspace: TrustedWorkspace) {
  const profile = await readProfile(admin, workspace.id);
  if (!profile) return undefined;
  const event: TurnEvent = {
    eventId: randomUUID(),
    workspaceId: workspace.id,
    conversationId: randomUUID(),
    channel: "whatsapp",
    text: "",
    occurredAt: new Date().toISOString()
  };
  const context = await loadTurnContext(admin, event, profile, randomUUID());
  return { context, aiMode: profile.ai_mode as AiMode };
}
