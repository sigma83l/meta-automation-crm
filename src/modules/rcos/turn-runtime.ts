import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnvironment } from "@/src/lib/env";
import type { AiMode, AiProvider } from "@/src/modules/ai/contracts";
import { decryptCredential } from "@/src/modules/ai/credential-vault";
import { selectAiProvider, type AiProviderSet } from "@/src/modules/ai/provider-selector";
import { DIALECTS } from "@/src/modules/ai/providers/dialects";
import { createHttpAiProvider } from "@/src/modules/ai/providers/http-provider";
import { MAX_RECENT_TURN_PAIRS } from "./context-budget";
import { currentFacts, type StoredFact } from "./memory-policy";
import { createAiTurnPorts, type ModelCallRecord, type TurnContext } from "./ai-turn-ports";
import {
  createDraftRegistry,
  createSupabaseTurnPorts,
  type DecisionContext,
  type TurnSubject
} from "./supabase-turn-ports";
import type { TurnEvent, TurnPorts } from "./turn-engine";

/**
 * Assembles one workspace's turn.
 *
 * Three things had to meet for the engine to run against anything real: a
 * context loaded from the workspace's own knowledge, a provider holding that
 * workspace's key, and the durable ports. This is where they meet, and it is
 * the only file that knows all three exist.
 *
 * The most important property here is what happens when configuration is
 * missing, because in every current environment it is: no model identifiers are
 * set and the platform keys are placeholders. Nothing throws. An unresolvable
 * model produces an uncertain understanding, an empty draft, a failed
 * validation and a handoff — the path the engine already has for "we do not
 * know", reached by configuration exactly as it is reached by a provider
 * outage. A turn on an unconfigured workspace therefore stores the customer's
 * message and puts the conversation in front of a person, which is the correct
 * behaviour and not a degraded one.
 */

/** How many past messages a turn may see. Pairs, so twice this many rows. */
const TRANSCRIPT_ROWS = MAX_RECENT_TURN_PAIRS * 2;

/**
 * How many remembered facts one turn may carry.
 *
 * The context budget reserves `customer_memory` 250 tokens at its widest, and a
 * fact is a short key and a short value. Reading more would only mean trimming
 * more, and trimming decides by position rather than by what matters - so the
 * bound goes here, on the newest facts, rather than downstream.
 */
const MEMORY_ROWS = 24;

type ProfileRow = Readonly<{
  primary_language: string;
  fallback_language: string;
  forbidden_claims: string[] | null;
  escalation_keywords: string[] | null;
  low_confidence_threshold: number | string;
  business_hours: Record<string, string> | null;
  ai_mode: string;
  demo_mode_enabled: boolean;
}>;

type RoleProviders = Readonly<{
  utility?: AiProvider;
  primary?: AiProvider;
  escalation?: AiProvider;
}>;

/**
 * Builds one provider per router role.
 *
 * Per role, not per workspace, and that is the whole point of this function.
 * `createHttpAiProvider` binds a model at construction, while the router
 * resolves a model per call — so a single shared provider would send every
 * role's traffic to whichever model happened to be baked in, and the registry
 * the router insists on would decide nothing. One provider per role is what
 * makes `AI_MODEL_UTILITY` and `AI_MODEL_PRIMARY` mean what they say.
 *
 * A role with no configured model gets no provider, which is the same absence
 * `resolveModel` reports, reached from the other side. Both lead to a handoff.
 */
async function providersForWorkspace(
  admin: SupabaseClient,
  workspaceId: string,
  mode: AiMode
): Promise<RoleProviders> {
  const env = getServerEnvironment();

  // FREE_GEMINI_DEMO_SYNTHETIC_ONLY is restricted to synthetic data in explicit
  // Demo mode (assertAiModePrivacy). Everything arriving through this pipeline
  // is a real customer message classified 'webhook', so the mode can never be
  // satisfied here. Returning no provider hands the turn to a person rather
  // than sending a real customer's words to a free tier.
  if (mode === "FREE_GEMINI_DEMO_SYNTHETIC_ONLY") return {};

  const platformKey =
    env.platformAiProvider === "gemini"
      ? env.platformGeminiApiKey
      : env.platformAiProvider === "openai"
        ? env.platformOpenAiApiKey
        : env.platformAnthropicApiKey;

  // Decrypted once, not once per role: three decryptions of the same envelope
  // would be three chances to fail and no extra safety.
  let byok: Readonly<{ provider: "gemini" | "openai" | "anthropic"; apiKey: string }> | undefined;
  if (mode.startsWith("WORKSPACE_BYOK_") && env.credentialEncryptionKey) {
    const provider = mode.replace("WORKSPACE_BYOK_", "").toLowerCase() as
      "gemini" | "openai" | "anthropic";
    const { data } = await admin
      .from("workspace_ai_credentials")
      .select("ciphertext,iv,auth_tag")
      .eq("workspace_id", workspaceId)
      .eq("provider", provider)
      // A credential that is stored but not 'active' has failed a real test
      // call. Using it would fail again, more expensively and in front of a
      // customer.
      .eq("status", "active")
      .maybeSingle();
    if (data) {
      try {
        byok = {
          provider,
          apiKey: decryptCredential(
            {
              ciphertext: data.ciphertext as string,
              iv: data.iv as string,
              authTag: data.auth_tag as string
            },
            env.credentialEncryptionKey
          )
        };
      } catch {
        // A key we cannot decrypt is a key we do not have. Left absent so the
        // turn hands off rather than failing the whole job.
      }
    }
  }

  const forModel = (model: string): AiProvider | undefined => {
    const set: Partial<AiProviderSet> = {
      ...(platformKey
        ? {
            platform: createHttpAiProvider({
              dialect: DIALECTS[env.platformAiProvider],
              apiKey: platformKey,
              model,
              timeoutMs: env.aiProviderTimeoutMs
            })
          }
        : {}),
      ...(byok
        ? {
            [byok.provider]: createHttpAiProvider({
              dialect: DIALECTS[byok.provider],
              apiKey: byok.apiKey,
              model,
              timeoutMs: env.aiProviderTimeoutMs
            })
          }
        : {})
    };
    const selected = selectAiProvider(mode, set as AiProviderSet);
    return selected.ok ? selected.value : undefined;
  };

  const utility = env.aiModels.utility ? forModel(env.aiModels.utility) : undefined;
  const primary = env.aiModels.primary ? forModel(env.aiModels.primary) : undefined;
  const escalation = env.aiModels.escalation ? forModel(env.aiModels.escalation) : undefined;

  return {
    ...(utility ? { utility } : {}),
    ...(primary ? { primary } : {}),
    ...(escalation ? { escalation } : {})
  };
}

/**
 * Loads everything one turn is allowed to know.
 *
 * Only enabled FAQ and price rows: a disabled item is one the workspace has
 * decided must not be quoted, and offering it to the model would let it be
 * cited and approved. The transcript is bounded by the context budget's own
 * limit rather than an arbitrary number.
 */
async function loadTurnContext(
  admin: SupabaseClient,
  event: TurnEvent,
  profile: ProfileRow,
  customerId: string
): Promise<TurnContext> {
  const [faqs, prices, transcript, facts] = await Promise.all([
    admin
      .from("business_faq_items")
      .select("id,question,answer")
      .eq("workspace_id", event.workspaceId)
      .eq("enabled", true)
      .order("created_at"),
    admin
      .from("business_price_items")
      .select("id,name,amount_minor,currency,availability")
      .eq("workspace_id", event.workspaceId)
      .eq("enabled", true)
      .order("created_at"),
    admin
      .from("messages")
      .select("direction,body,sent_at")
      .eq("workspace_id", event.workspaceId)
      .eq("conversation_id", event.conversationId)
      .order("sent_at", { ascending: false })
      .limit(TRANSCRIPT_ROWS),
    // The read half of customer memory. `persistFacts` has been filling this
    // table since step 9 of the pack and nothing read it back, which made the
    // memory write-only: a customer who confirmed their location last week was
    // asked for it again this week, because the model's whole view of them was
    // one conversation's transcript.
    admin
      .from("contact_facts")
      .select("fact_key,fact_value,confidence,source_ref,recorded_at,valid_until")
      .eq("workspace_id", event.workspaceId)
      .eq("customer_id", customerId)
      .order("recorded_at", { ascending: false })
      .limit(MEMORY_ROWS)
  ]);

  const messages = (transcript.data ?? [])
    .slice()
    .reverse()
    .map((row) => ({
      role: (row.direction === "inbound" ? "customer" : "business") as "customer" | "business",
      content: String(row.body ?? "")
    }));

  // Expiry is applied here rather than in SQL so one implementation decides it.
  // `hasExpired` is what the write path already consults, and a `valid_until >
  // now()` predicate beside it would be a second answer to the same question -
  // able to disagree about the boundary, and only in production.
  const stored = (facts.data ?? []).map(
    (row) =>
      ({
        key: String(row.fact_key),
        value: String(row.fact_value),
        confidence: String(row.confidence),
        sourceRef: String(row.source_ref ?? ""),
        recordedAt: String(row.recorded_at ?? ""),
        validUntil: (row.valid_until as string | null) ?? null
      }) as StoredFact
  );
  const knownFacts = currentFacts(stored).map(({ key, value, confidence }) => ({
    key,
    value,
    confidence
  }));

  return {
    requiredFields: [],
    knownFacts,
    faqItems: (faqs.data ?? []).map((row) => ({
      id: String(row.id),
      question: String(row.question),
      answer: String(row.answer)
    })),
    priceItems: (prices.data ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      amountMinor: Number(row.amount_minor),
      currency: String(row.currency),
      availability: row.availability as "available" | "unavailable" | "ask_human"
    })),
    policy: {
      primaryLanguage: profile.primary_language,
      fallbackLanguage: profile.fallback_language,
      forbiddenClaims: profile.forbidden_claims ?? [],
      escalationKeywords: profile.escalation_keywords ?? [],
      lowConfidenceThreshold: Number(profile.low_confidence_threshold)
    },
    // Business hours are the workspace's own approved statement of when it is
    // open, so they are the one class of time a reply may state. Anything else
    // the validator blocks.
    approvedTimes: Object.values(profile.business_hours ?? {}),
    messages,
    // A message that arrived from a real provider is provider data, whatever
    // the workspace's demo setting says. Mislabelling it would let the privacy
    // gate treat a real customer as a fixture.
    classification: "webhook",
    demoMode: profile.demo_mode_enabled
  };
}

export type TurnRuntime = Readonly<{ ports: TurnPorts }>;

/**
 * Everything `runTurn` needs for one event, or nothing.
 *
 * Returns undefined only when the workspace has no business profile — meaning
 * onboarding never completed — because there is then no policy, no language and
 * no knowledge, and a turn would be answering on behalf of a business that has
 * not said anything about itself.
 */
export async function createTurnRuntime(
  admin: SupabaseClient,
  event: TurnEvent,
  subject: TurnSubject
): Promise<TurnRuntime | undefined> {
  const env = getServerEnvironment();
  const { data: profileRow } = await admin
    .from("business_profiles")
    .select(
      "primary_language,fallback_language,forbidden_claims,escalation_keywords,low_confidence_threshold,business_hours,ai_mode,demo_mode_enabled"
    )
    .eq("workspace_id", event.workspaceId)
    .maybeSingle();
  if (!profileRow) return undefined;

  const profile = profileRow as ProfileRow;
  const mode = profile.ai_mode as AiMode;

  // Loaded once and shared: the model ports and the decision port must reason
  // about the same knowledge, or a turn can be decided against one set of
  // escalation keywords and composed against another.
  let context: Promise<TurnContext> | undefined;
  const contextFor = (turn: TurnEvent) => {
    context ??= loadTurnContext(admin, turn, profile, subject.customerId);
    return context;
  };

  const providers = await providersForWorkspace(admin, event.workspaceId, mode);
  const drafts = createDraftRegistry();
  // Collected per turn and handed to observe(). Without this an empty draft is
  // reported identically whether no model was configured, the provider refused
  // the key, or the model answered and asked for a person - three causes with
  // three different owners, arriving as one reason code.
  const calls: ModelCallRecord[] = [];

  const aiPorts = createAiTurnPorts({
    // Possibly empty. No provider at all is a legitimate state — an
    // unconfigured workspace, a placeholder key, a credential that failed its
    // test — and the turn resolves every one of them to a handoff.
    providers,
    models: env.aiModels,
    loadContext: contextFor,
    onCall: (record) => void calls.push(record)
  });

  const decisionContext = async (turn: TurnEvent): Promise<DecisionContext> => {
    const loaded = await contextFor(turn);
    return {
      escalationKeywords: loaded.policy.escalationKeywords,
      lowConfidenceThreshold: loaded.policy.lowConfidenceThreshold
    };
  };

  const durablePorts = createSupabaseTurnPorts({
    admin,
    subject,
    send: {
      liveSendEnabled: env.liveProviderSendEnabled,
      recipientAllowlist: env.liveTestRecipientAllowlist,
      // No approval mechanism exists yet, so this is false everywhere. Named
      // rather than omitted because the gate requires all three and a reader
      // should see which one is missing.
      explicitApproval: false
    },
    decisionContext,
    draft: (eventId) => drafts.get(eventId),
    modelCalls: () => calls
  });

  return {
    ports: {
      ...durablePorts,
      ...aiPorts,
      async compose(turn, decision) {
        // Wrapped rather than reimplemented: `commit` needs the text and the
        // engine does not pass it, so this is where the draft is captured.
        const reply = await aiPorts.compose(turn, decision);
        drafts.record(turn.eventId, reply);
        return reply;
      }
    }
  };
}
