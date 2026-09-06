import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeWorkspaceEntitlement } from "@/src/modules/billing/entitlement";
import type { SubscriptionStatus } from "@/src/modules/billing/contracts";
import { authorizeOutboundSend } from "@/src/modules/integrations/live-send-gate";
import { CONTACT_FACTS_CONFLICT } from "@/src/modules/crm/ai-write";
import { isFeatureEnabled, isPlatformSwitchEnabled } from "@/src/modules/features/server/gate";
import type { ModelCallRecord } from "./ai-turn-ports";
import type { StoredFact } from "./memory-policy";
import {
  sendRefFor,
  type ComposedReply,
  type TurnDecision,
  type TurnEvent,
  type TurnPolicy,
  type TurnPorts,
  type TurnRecord
} from "./turn-engine";

/**
 * The ports that talk to the database and to the provider.
 *
 * `createAiTurnPorts` supplies the three that involve a model. These are the
 * other ten, and between them the turn engine finally has a caller that is not
 * a test.
 *
 * The ordering guarantees are the engine's; what these owe it is durability.
 * Two in particular:
 *
 *   - `isNewEvent` and `commit` are the same row. Deduplication that lives in
 *     memory is deduplication that a redeploy resets, and the relay is
 *     explicitly a retrying, concurrent cron.
 *   - `send` never sends. It authorises, persists what would go out, and stops.
 *     There is no outbound adapter in this repository, and a port that quietly
 *     did nothing while reporting success would make that indistinguishable
 *     from a working one.
 */

export type TurnSubject = Readonly<{
  customerId: string;
  /** The provider-side recipient: a phone number or account id. */
  recipientRef: string;
  connectionMode: "sandbox" | "live";
}>;

export type TurnPolicyInputs = Readonly<{
  /** From the environment gate, never from a workspace setting. */
  liveSendEnabled: boolean;
  recipientAllowlist: readonly string[];
  /** Operator sign-off for live sending. Absent in every current environment. */
  explicitApproval: boolean;
}>;

export type DecisionContext = Readonly<{
  escalationKeywords: readonly string[];
  lowConfidenceThreshold: number;
}>;

export type SupabaseTurnDependencies = Readonly<{
  admin: SupabaseClient;
  subject: TurnSubject;
  send: TurnPolicyInputs;
  /** Read from the same loaded context the model ports use. */
  decisionContext(event: TurnEvent): Promise<DecisionContext>;
  /** The reply `compose` produced this turn. */
  draft(eventId: string): ComposedReply | undefined;
  /**
   * The model calls this turn made. Read at observe time so the audit row can
   * say whether a handoff came from an unconfigured model, a failed call, or a
   * model that answered and asked for a person.
   */
  modelCalls?(eventId: string): readonly ModelCallRecord[];
}>;

/**
 * Holds the composed reply between `compose` and `commit`.
 *
 * `commit` receives a TurnRecord, which carries the outcome and the reasons but
 * deliberately no message text — the engine has no business knowing how a reply
 * is stored. Something still has to carry the draft across those two steps, and
 * a registry scoped to one turn is that, in the same shape `createAiTurnPorts`
 * already uses for its context.
 */
export type DraftRegistry = Readonly<{
  record(eventId: string, reply: ComposedReply): void;
  get(eventId: string): ComposedReply | undefined;
}>;

export function createDraftRegistry(): DraftRegistry {
  const drafts = new Map<string, ComposedReply>();
  return Object.freeze({
    record: (eventId, reply) => void drafts.set(eventId, reply),
    get: (eventId) => drafts.get(eventId)
  });
}

/** Reasons a turn is refused before any model is called. */
export const POLICY_BLOCKS = [
  "human_takeover",
  "conversation_closed",
  "conversation_missing",
  "billing_entitlement_required",
  // The workspace's plan or a staff override withholds assistant replies.
  "ai_replies_disabled",
  // Switched off platform-wide by an operator. Distinct from the above because
  // the two have different owners and different fixes: one is a conversation
  // with us about the plan, the other is us, and only one of them will resolve
  // on its own.
  "ai_replies_paused"
] as const;

export type PolicyBlock = (typeof POLICY_BLOCKS)[number];

export function createSupabaseTurnPorts(
  dependencies: SupabaseTurnDependencies
): Omit<TurnPorts, "understand" | "retrieve" | "compose"> {
  const { admin, subject } = dependencies;

  return {
    async isNewEvent(event) {
      const { data, error } = await admin
        .from("turn_records")
        .select("id")
        .eq("workspace_id", event.workspaceId)
        .eq("event_id", event.eventId)
        .maybeSingle();
      // A read that failed is not an absence. Treating it as one would run the
      // turn again, which is the exact outcome the check exists to prevent.
      if (error) throw new Error("TURN_DEDUPE_READ_FAILED");
      return data === null;
    },

    async hydrate(event) {
      // `contact_facts` matches StoredFact column for column, including all
      // four confidence levels, and until now nothing in TypeScript read or
      // wrote it - so the engine counted memory writes it then discarded. An
      // earlier comment here claimed the table did not exist, on the strength
      // of REPO_BASELINE.md's "genuinely absent" list; the table landed in
      // 20260815150000_crm_revenue_state.sql and that list is stale.
      //
      // `persistFacts` is the other half: what the memory policy accepts this
      // turn is what the next turn reads back here.
      const { data, error } = await admin
        .from("contact_facts")
        .select("fact_key,fact_value,confidence,source_ref,recorded_at,valid_until")
        .eq("workspace_id", event.workspaceId)
        .eq("customer_id", subject.customerId);
      // A turn without memory is worse than a turn with it, but far better than
      // no turn at all: the customer's message is already stored either way.
      if (error || !data) return { facts: [] as readonly StoredFact[] };

      const facts: readonly StoredFact[] = data.map((row) => ({
        key: String(row.fact_key),
        value: String(row.fact_value),
        confidence: row.confidence as StoredFact["confidence"],
        sourceRef: String(row.source_ref),
        recordedAt: String(row.recorded_at),
        validUntil: (row.valid_until as string | null) ?? null
      }));
      return { facts };
    },

    async evaluatePolicy(event): Promise<TurnPolicy> {
      const [conversation, subscription] = await Promise.all([
        admin
          .from("conversations")
          .select("state,owner")
          .eq("workspace_id", event.workspaceId)
          .eq("id", event.conversationId)
          .maybeSingle(),
        admin
          .from("workspace_subscriptions")
          .select("status,trial_ends_at,current_period_ends_at")
          .eq("workspace_id", event.workspaceId)
          .maybeSingle()
      ]);
      if (conversation.error || subscription.error) throw new Error("TURN_POLICY_READ_FAILED");

      // No tools are registered in V1. An empty list is what makes
      // `authorizeAction` refuse every request the model could make, so a tool
      // cannot be reached by adding one to a prompt.
      const allowedActions: readonly string[] = [];
      const blocked = (blockedReason: PolicyBlock): TurnPolicy => ({
        canSend: false,
        allowedActions,
        blockedReason
      });

      if (!conversation.data) return blocked("conversation_missing");
      // A person took the conversation. Answering over them is worse than not
      // answering: the customer gets two voices and the person loses the thread.
      if (conversation.data.owner === "human") return blocked("human_takeover");
      if (conversation.data.state !== "open") return blocked("conversation_closed");

      const entitlement = subscription.data
        ? authorizeWorkspaceEntitlement({
            status: subscription.data.status as SubscriptionStatus,
            trialEndsAt: subscription.data.trial_ends_at as string | null,
            currentPeriodEndsAt: subscription.data.current_period_ends_at as string | null
          })
        : null;
      // Checked before the model, not after: an unentitled workspace should
      // cost nothing to serve, and the customer's message is still stored
      // either way.
      if (!entitlement || !entitlement.ok) return blocked("billing_entitlement_required");

      // After entitlement, deliberately. When a lapsed subscription and a
      // withheld feature are both true, the billing reason is the one the
      // workspace can act on, and reporting ours instead would hide the problem
      // they can actually fix.
      //
      // Read here rather than at the job boundary so a turn reaching the engine
      // by any route is gated the same way, and so the refusal lands in
      // `turn_records` with a reason the review surface can explain. Both fail
      // closed: a turn that cannot establish permission does not get a model,
      // it gets a person.
      if (!(await isPlatformSwitchEnabled(admin, "ai_replies"))) {
        return blocked("ai_replies_paused");
      }
      if (!(await isFeatureEnabled(admin, event.workspaceId, "ai_replies"))) {
        return blocked("ai_replies_disabled");
      }

      return { canSend: true, allowedActions };
    },

    async decide(event, understanding): Promise<TurnDecision> {
      const context = await dependencies.decisionContext(event);
      const text = event.text.toLowerCase();

      // The workspace's own words come first. Somebody who listed "refund" as
      // an escalation keyword has decided that no model answers it, and that
      // decision outranks how confident this turn happens to feel.
      const matched = context.escalationKeywords.find(
        (keyword) => keyword.trim().length > 0 && text.includes(keyword.toLowerCase())
      );
      if (matched) {
        return {
          type: "handoff",
          priority: "p0_safety_policy",
          reasonCodes: ["escalation_keyword"]
        };
      }

      const confidence = understanding.intents[0]?.confidence ?? 0;
      if (confidence < context.lowConfidenceThreshold) {
        return {
          type: "handoff",
          priority: "p0_safety_policy",
          reasonCodes: ["low_confidence"]
        };
      }

      return {
        type: "answer",
        priority: "p1_explicit_request",
        reasonCodes: ["answer_from_knowledge"]
      };
    },

    async executeTool() {
      // Unreachable while `allowedActions` is empty: `authorizeAction` refuses
      // first and the engine returns `tool_refused` without getting here. It
      // throws rather than returning a benign result so that adding an action
      // without adding an implementation fails loudly.
      throw new Error("NO_TOOLS_REGISTERED");
    },

    async persistFacts(event, facts) {
      if (facts.length === 0) return 0;

      // The table holds one row per key per customer, so an accepted write is
      // an upsert on that key and history lives in the audit trail.
      const { error } = await admin.from("contact_facts").upsert(
        facts.map((fact) => ({
          workspace_id: event.workspaceId,
          customer_id: subject.customerId,
          fact_key: fact.key,
          fact_value: fact.value,
          confidence: fact.confidence,
          source_ref: fact.sourceRef,
          recorded_at: fact.recordedAt,
          valid_until: fact.validUntil ?? null,
          updated_at: new Date().toISOString()
        })),
        // Named once, in the CRM module, because that module's write engine
        // upserts the same table: two spellings of this target is how a
        // customer ends up with two budgets.
        { onConflict: CONTACT_FACTS_CONFLICT }
      );
      // Reported, not thrown. The engine turns a short count into a
      // `memory_write_failed` reason code on the turn record, which is visible
      // to an operator; throwing here would cost the customer their reply for
      // a fact that could be re-observed on the next message anyway.
      if (error) return 0;
      return facts.length;
    },

    async commit(record: TurnRecord) {
      const draft = dependencies.draft(record.eventId);
      const sendRef = record.outcome === "sent" ? sendRefFor(record) : null;

      const { error } = await admin.from("turn_records").insert({
        workspace_id: record.workspaceId,
        conversation_id: record.conversationId,
        event_id: record.eventId,
        outcome: record.outcome,
        reason_codes: record.reasonCodes,
        accepted_memory_writes: record.acceptedMemoryWrites,
        refused_memory_writes: record.refusedMemoryWrites,
        tool_executed: record.toolExecuted,
        send_ref: sendRef
      });
      if (error) throw new Error("TURN_COMMIT_FAILED");

      // The outbound row is written here, before anything is sent, and at
      // 'prepared'. That is the ordering the engine requires: a message that
      // left with no record of it is unrecoverable, whereas a record of a
      // message that never left is visible and fixable.
      if (record.outcome === "sent" && draft && draft.text.trim().length > 0) {
        const outbound = await admin.from("messages").insert({
          workspace_id: record.workspaceId,
          conversation_id: record.conversationId,
          customer_id: subject.customerId,
          direction: "outbound",
          status: "prepared",
          body: draft.text,
          // The send ref is the idempotency key. Using it as the provider id
          // means a replayed turn collides on the unique index instead of
          // writing a second copy of the same reply.
          provider_message_id: sendRef
        });
        if (outbound.error) throw new Error("TURN_OUTBOUND_PERSIST_FAILED");
      }

      // A handoff that nobody can see is not a handoff. This is what puts the
      // conversation in front of a person in /inbox.
      if (record.outcome === "handoff") {
        const flagged = await admin
          .from("conversations")
          .update({ requires_human_review: true, updated_at: new Date().toISOString() })
          .eq("workspace_id", record.workspaceId)
          .eq("id", record.conversationId);
        if (flagged.error) throw new Error("TURN_HANDOFF_FLAG_FAILED");
      }
    },

    async send(_reply: ComposedReply, sendRef: string) {
      const authorization = authorizeOutboundSend({
        mode: subject.connectionMode,
        environmentEnabled: dependencies.send.liveSendEnabled,
        explicitApproval: dependencies.send.explicitApproval,
        recipientAllowlisted: dependencies.send.recipientAllowlist.includes(subject.recipientRef)
      });

      // Blocked or sandboxed, the reply stays at 'prepared' — composed,
      // validated, stored, and not delivered. That is the intended resting
      // state of this system today and it is not an error.
      if (!authorization.ok || authorization.value === "SANDBOX") return;

      // Every gate opened and there is still nothing to send with. This is a
      // misconfiguration rather than a runtime condition: somebody enabled live
      // sending against a build that has no outbound adapter. The turn is
      // already committed, so the retry sees `isNewEvent` false and stops
      // rather than looping.
      throw new Error(`LIVE_SEND_ADAPTER_MISSING:${sendRef}`);
    },

    async observe(record: TurnRecord) {
      // Never the message, never the draft: reason codes and counts only. This
      // table is read by operators and is not covered by the conversation's
      // retention policy.
      // Token counts and model identifiers only. A provider's own error text
      // can echo the request, and the request carries customer messages, so the
      // failure code travels and the message never does.
      const calls = (dependencies.modelCalls?.(record.eventId) ?? []).map((call) => ({
        role: call.role,
        model: call.model,
        outcome: call.outcome,
        ...(call.failureCode ? { failureCode: call.failureCode } : {}),
        ...(call.failureKind ? { failureKind: call.failureKind } : {}),
        ...(call.deferredToHuman === undefined ? {} : { deferredToHuman: call.deferredToHuman }),
        ...(call.usage
          ? { inputTokens: call.usage.inputTokens, outputTokens: call.usage.outputTokens }
          : {})
      }));

      const { error } = await admin.from("ai_execution_audit_events").insert({
        workspace_id: record.workspaceId,
        event_type: "rcos_turn",
        status: record.outcome,
        safe_details: {
          conversationId: record.conversationId,
          eventId: record.eventId,
          reasonCodes: record.reasonCodes,
          toolExecuted: record.toolExecuted,
          acceptedMemoryWrites: record.acceptedMemoryWrites,
          refusedMemoryWrites: record.refusedMemoryWrites,
          // Empty means no model was reached at all this turn.
          modelCalls: calls
        }
      });
      // Deliberately swallowed. Observation failing must not undo a committed
      // turn: the engine runs this last for exactly that reason, and a lost
      // audit row is worth less than a turn re-run against a customer.
      void error;
    },

    async sentRefs(event) {
      const { data, error } = await admin
        .from("turn_records")
        .select("send_ref")
        .eq("workspace_id", event.workspaceId)
        .eq("conversation_id", event.conversationId)
        .not("send_ref", "is", null);
      if (error) throw new Error("TURN_SENT_REFS_READ_FAILED");
      return (data ?? [])
        .map((row) => (row as { send_ref: string | null }).send_ref)
        .filter((ref): ref is string => ref !== null);
    }
  };
}
