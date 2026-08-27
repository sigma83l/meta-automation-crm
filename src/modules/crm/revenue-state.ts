/**
 * Lifecycle, lead status and qualification, kept apart.
 *
 * These answer three different questions and are constantly conflated:
 *
 *   lifecycle  how far the relationship has progressed
 *   status     what this conversation is waiting on right now
 *   score      how well the contact fits and how ready they are
 *
 * A contact can be Qualified and Awaiting Customer at the same time; a Customer
 * can be in Follow-up; a high score does not move anybody forward on its own.
 * Deriving any one of these from another is what turns a pipeline into a number
 * nobody trusts, so nothing here does that.
 *
 * Pure by design; persistence lives in the migration of the same name.
 */

export const LIFECYCLE_STAGES = [
  "new",
  "engaged",
  "qualified",
  "sales_ready",
  "opportunity",
  "customer",
  "retention"
] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const LEAD_STATUSES = [
  "awaiting_customer",
  "follow_up",
  "booked",
  "payment_pending",
  "lost"
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export type LifecycleTransition = Readonly<{
  from: LifecycleStage;
  to: LifecycleStage;
  reasonCodes: readonly string[];
  evidenceRef?: string;
  actor: string;
}>;

export type TransitionVerdict =
  Readonly<{ allowed: true }> | Readonly<{ allowed: false; reason: string }>;

function stageIndex(stage: LifecycleStage): number {
  return LIFECYCLE_STAGES.indexOf(stage);
}

/**
 * Whether a lifecycle move is permitted.
 *
 * Forward movement may skip stages — a referral can arrive sales-ready — but it
 * always needs a reason, because a stage that advanced for no recorded cause
 * cannot be explained to the owner or corrected afterwards.
 *
 * Backward movement is allowed too: deals stall and relationships lapse, and a
 * model that only moves forward slowly fills up with contacts marked Customer
 * who are nothing of the kind. It carries the same evidence requirement.
 */
export function authorizeLifecycleTransition(transition: LifecycleTransition): TransitionVerdict {
  if (transition.from === transition.to) {
    return { allowed: false, reason: "no change" };
  }
  if (!transition.reasonCodes.length) {
    return { allowed: false, reason: "reason codes required" };
  }
  if (!transition.actor) {
    return { allowed: false, reason: "actor required" };
  }
  // Retention follows the relationship ending well; nothing reaches it without
  // having been a customer first.
  if (transition.to === "retention" && stageIndex(transition.from) < stageIndex("customer")) {
    return { allowed: false, reason: "retention requires a prior customer stage" };
  }
  return { allowed: true };
}

export function isForwardTransition(from: LifecycleStage, to: LifecycleStage): boolean {
  return stageIndex(to) > stageIndex(from);
}

// Scoring used to live here, as `scoreFromEvidence` over a `QualificationSignal`
// that made its evidence reference optional. It produced a bare number: no
// components, no config version, no record of what it rested on, and no way to
// refuse a weight that named no source. It has moved to qualification-score.ts,
// which answers the two questions a score is actually asked - why is it this
// number, and why did it change - and it is not kept here alongside it, because
// two scorers in one module is an invitation to call the one that cannot
// explain itself.

export type QualificationDepth = "first_contact" | "consideration" | "ready" | "high_value";

/**
 * What may be asked at this point in the conversation.
 *
 * The pack's rule is blunt and worth honouring literally: never ask a question
 * merely because the CRM has a field. Interrogating a first-time enquirer about
 * budget is how a conversation ends before it starts, so each depth exposes
 * only the slots that change what happens next.
 */
export function permittedQuestions(depth: QualificationDepth): readonly string[] {
  switch (depth) {
    case "first_contact":
      // Intent plus the single constraint without which no useful answer exists.
      return ["intent", "primary_constraint"];
    case "consideration":
      return ["fit", "desired_outcome", "timing"];
    case "ready":
      // Only what the transaction itself cannot proceed without.
      return ["transaction_required_slots"];
    case "high_value":
      return ["budget", "decision_process"];
  }
}

export function mayAsk(depth: QualificationDepth, slot: string): boolean {
  return permittedQuestions(depth).includes(slot);
}

// Note: there is deliberately no function mapping a lifecycle stage to a lead
// status or vice versa. The two vocabularies do not correspond, and anything
// claiming to derive one from the other would be inventing information.
