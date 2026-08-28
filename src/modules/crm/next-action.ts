/**
 * What to do next, proposed and never performed.
 *
 * `backend/04_NEXT_ACTION_CONTRACT.md` is emphatic on one point: the CRM
 * proposes, and execution belongs to the domain that owns the send. This
 * repository already has that boundary - `authorizeOutboundSend` and the outbox
 * - so the rule is inherited rather than rebuilt. Nothing in this file sends,
 * schedules, or writes; it returns a description of an action somebody else
 * may carry out.
 *
 * The derivation reuses the attention engine rather than restating its rules.
 * That is deliberate. "What is going on with this contact" is a question with
 * one answer, and two rule sets computing it separately would drift - the same
 * reason `record_lifecycle_transition` leaves the transition rules in
 * TypeScript instead of re-encoding them in SQL. So attention decides what
 * governs, and this file decides what to do about it. The reason codes the
 * contract asks for come straight out of that verdict, which is why they can be
 * trusted to explain the action.
 *
 * Pure by design; no I/O.
 */

import {
  ATTENTION_PRIORITIES,
  rankAttention,
  type AttentionReason,
  type AttentionState
} from "./attention-priority";

/** The candidate actions, from `CRM_NEXT_ACTION_SCHEMA`. */
export const NEXT_ACTION_TYPES = [
  "reply",
  "clarify",
  "qualify",
  "task",
  "follow_up",
  "assign",
  "handoff",
  "booking",
  "wait",
  "close"
] as const;
export type NextActionType = (typeof NEXT_ACTION_TYPES)[number];

export const ACTION_OWNERS = ["human", "ai", "automation", "system"] as const;
export type ActionOwner = (typeof ACTION_OWNERS)[number];

export const ACTION_ELIGIBILITY = ["eligible", "blocked", "needs_review", "scheduled"] as const;
export type ActionEligibility = (typeof ACTION_ELIGIBILITY)[number];

/** Where the proposal came from. A model's suggestion is never mistaken for a rule. */
export const ACTION_SOURCES = ["derived", "ai", "human"] as const;
export type ActionSource = (typeof ACTION_SOURCES)[number];

export type NextActionState = AttentionState &
  Readonly<{
    /** Who the contact belongs to, if anybody. */
    ownerId?: string | null;
    /** Whether any qualification evidence exists at all. */
    hasEvidence?: boolean;
  }>;

export type ProposedAction = Readonly<{
  type: NextActionType;
  reasonCodes: readonly string[];
  ownerType: ActionOwner;
  ownerId: string | null;
  dueAt: string | null;
  eligibility: ActionEligibility;
  /**
   * How much the proposal is worth, 0..1. A derived action is 1 because a rule
   * either fired or it did not; the field exists for proposals that are
   * genuinely guesses, and a model's suggestion carries its own.
   */
  confidence: number;
  source: ActionSource;
}>;

const rank = (priority: (typeof ATTENTION_PRIORITIES)[number]) =>
  ATTENTION_PRIORITIES.indexOf(priority);

/**
 * Which reason the action answers.
 *
 * Not simply "whatever set the priority", because a cap and a demotion are
 * different things. A cap to Low - opted out, closed, snoozed - says nothing is
 * actionable, and it governs: proposing a reply to somebody who opted out would
 * be worse than proposing nothing. A cap to Normal - awaiting customer - says
 * only that this is not urgent, and it does not govern, because the thing to do
 * is still whatever the raising reason named.
 *
 * That is the case where the two questions genuinely come apart: an unanswered
 * message from a contact whose move it is ranks Normal and the action is still
 * reply.
 *
 * A request for a person always governs, as it is never capped in the first
 * place.
 */
function governingReason(
  reasons: readonly AttentionReason[],
  priority: (typeof ATTENTION_PRIORITIES)[number]
): AttentionReason | null {
  const human = reasons.find((reason) => reason.code === "human_requested");
  if (human) return human;

  const raises = reasons.filter((reason) => reason.effect === "raises");
  const highest = raises.reduce(
    (best, reason) => (rank(reason.level) > rank(best) ? reason.level : best),
    "low" as (typeof ATTENTION_PRIORITIES)[number]
  );
  const strictestCap = reasons
    .filter((reason) => reason.effect === "caps")
    .reduce<AttentionReason | null>(
      (strictest, reason) =>
        !strictest || rank(reason.level) < rank(strictest.level) ? reason : strictest,
      null
    );

  // Nothing is actionable. The cap is what the operator is looking at.
  if (priority === "low" && strictestCap) return strictestCap;

  // Otherwise the strongest thing arguing for action decides, and the cap - if
  // any - has already done its work on the priority.
  return raises.find((reason) => reason.level === highest) ?? strictestCap ?? null;
}

const derived = (
  type: NextActionType,
  ownerType: ActionOwner,
  eligibility: ActionEligibility,
  reasonCodes: readonly string[],
  ownerId: string | null,
  dueAt: string | null
): ProposedAction => ({
  type,
  reasonCodes,
  ownerType,
  ownerId,
  dueAt,
  eligibility,
  confidence: 1,
  source: "derived"
});

/**
 * Proposes the next action for one contact.
 *
 * `close` is in the vocabulary and nothing here derives it. Deciding a
 * relationship is over is a judgement, not something current state can tell
 * you, so it stays available for a person or a model to propose and is never
 * inferred from a quiet week.
 */
export function proposeNextAction(state: NextActionState, now: Date = new Date()): ProposedAction {
  const attention = rankAttention(state, now);
  const governing = governingReason(attention.reasons, attention.priority);
  const codes = attention.reasons.map((reason) => reason.code);
  const owner = state.ownerId ?? null;
  const propose = (
    type: NextActionType,
    ownerType: ActionOwner,
    eligibility: ActionEligibility,
    dueAt: string | null = null
  ) => derived(type, ownerType, eligibility, codes, ownerType === "human" ? owner : null, dueAt);

  switch (governing?.code) {
    case "human_requested":
      return propose("handoff", "human", "needs_review");

    case "payment_pending":
      return propose("follow_up", "human", "eligible");

    case "unanswered_inbound":
      // Reply and clarify differ by what the reply is for. With no evidence at
      // all, answering is how you find out what they want; with evidence, the
      // conversation already has a subject.
      return propose(state.hasEvidence ? "reply" : "clarify", "human", "eligible");

    case "followup_overdue":
      return propose("follow_up", "human", "eligible");

    case "followup_due_soon":
      return propose("follow_up", "human", "scheduled", state.followUpDueAt ?? null);

    case "booked_upcoming":
      return propose("booking", "human", "scheduled");

    case "well_qualified":
      // Nothing is outstanding and the contact is worth progressing. Somebody
      // has to own that before anybody can do it.
      return owner ? propose("task", "human", "eligible") : propose("assign", "human", "eligible");

    case "awaiting_customer":
      return propose("wait", "system", "scheduled");

    case "followup_snoozed":
      return propose("wait", "system", "scheduled", state.followUpSnoozedUntil ?? null);

    case "opted_out":
    case "conversation_closed":
      // Blocked rather than `close`: there is nothing to do, which is not the
      // same as proposing to end the relationship.
      return propose("wait", "system", "blocked");

    default:
      // Nothing is going on and nothing is known. Finding out is the work.
      return propose("qualify", "human", "eligible");
  }
}
