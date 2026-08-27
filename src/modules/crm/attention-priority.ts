/**
 * What deserves attention now - which is not the same question as how good a
 * lead is.
 *
 * `05_REVENUE_STATE_MODEL.md` and `07_ATTENTION_PRIORITY_ENGINE.md` both make
 * keeping this apart from the qualification score a hard requirement, and the
 * two are conflated constantly. One asks how well this contact fits and how
 * ready they are; the other asks what an operator should open next. A fully
 * qualified lead with nothing outstanding is Normal priority, and that is
 * correct - there is nothing to do about them today.
 *
 * Two deliberate omissions.
 *
 * There is no 0-100 attention number. The pack is explicit that one must not be
 * invented without research showing it helps, and the reason is that a number
 * looks like a measurement: 72 and 68 imply a difference nobody can defend,
 * whereas Critical and High imply a decision somebody made. Four levels and
 * reason chips say exactly as much as is actually known.
 *
 * Nothing here is persisted. Priority is a function of the current state and
 * goes stale the moment anything moves - a stored one would be a cache with no
 * invalidation, quietly telling an operator to chase somebody who replied an
 * hour ago.
 *
 * Pure by design; no I/O.
 */

import type { LeadStatus, LifecycleStage } from "./revenue-state";

/** Ordered least to most urgent. Order is the comparison. */
export const ATTENTION_PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type AttentionPriority = (typeof ATTENTION_PRIORITIES)[number];

export const ATTENTION_REASONS = [
  "human_requested",
  "payment_pending",
  "unanswered_inbound",
  "followup_overdue",
  "followup_due_soon",
  "booked_upcoming",
  "well_qualified",
  "awaiting_customer",
  "followup_snoozed",
  "opted_out",
  "conversation_closed"
] as const;
export type AttentionReasonCode = (typeof ATTENTION_REASONS)[number];

/**
 * A reason either argues for a priority or caps it.
 *
 * Both are reported, because "why is this Low" needs answering as much as "why
 * is this Critical". A queue that silently demotes a contact is one an operator
 * stops trusting.
 */
export type AttentionReason = Readonly<{
  code: AttentionReasonCode;
  effect: "raises" | "caps";
  level: AttentionPriority;
}>;

export type AttentionVerdict = Readonly<{
  priority: AttentionPriority;
  reasons: readonly AttentionReason[];
}>;

export type AttentionState = Readonly<{
  leadStatus: LeadStatus;
  lifecycleStage: LifecycleStage;
  /** Inbound messages nobody has answered. */
  unreadInbound: number;
  /** A person was asked for, by the customer or by the automation giving up. */
  humanReviewRequested: boolean;
  /** The soonest live follow-up's due time. */
  followUpDueAt?: string | null;
  /** A follow-up deliberately deferred to a later time. */
  followUpSnoozedUntil?: string | null;
  optedOut: boolean;
  /** The latest snapshot's total, if this contact has ever been scored. */
  qualificationScore?: number | null;
}>;

/** Inside this window a due time is imminent rather than merely approaching. */
const SOON_MS = 24 * 60 * 60 * 1000;

/** The score at which a contact is worth surfacing on its own merits. */
const WELL_QUALIFIED = 70;

function rank(priority: AttentionPriority): number {
  return ATTENTION_PRIORITIES.indexOf(priority);
}

const parse = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
};

/**
 * Ranks one contact.
 *
 * The combination rule is deliberately not arithmetic: the priority is the
 * highest level any active signal argues for, then lowered to the strictest cap
 * in force. Adding weights and thresholding them would rebuild the 0-100 number
 * the pack rules out and merely hide it behind four labels - and it would make
 * two mild signals outrank one urgent one, which is not how a person triages.
 *
 * `now` is a parameter so a queue built twice from the same state ranks the
 * same way, and so a test does not have to move the clock.
 */
export function rankAttention(state: AttentionState, now: Date = new Date()): AttentionVerdict {
  const at = now.getTime();
  const reasons: AttentionReason[] = [];

  const raise = (code: AttentionReasonCode, level: AttentionPriority) =>
    reasons.push({ code, effect: "raises", level });
  const cap = (code: AttentionReasonCode, level: AttentionPriority) =>
    reasons.push({ code, effect: "caps", level });

  // A person asking for a person. Uncapped below, because every penalty here is
  // a reason not to send something, and this is a request to look rather than
  // to send. A queue that hides it because the contact is snoozed is the
  // failure this carve-out exists to prevent.
  const humanRequested = state.humanReviewRequested || state.leadStatus === "human_review";
  if (humanRequested) raise("human_requested", "critical");

  // Money with a deadline attached, and the one status where a delay costs the
  // customer something rather than just annoying them.
  if (state.leadStatus === "payment_pending") raise("payment_pending", "critical");

  if (state.unreadInbound > 0 || state.leadStatus === "needs_reply") {
    raise("unanswered_inbound", "high");
  }

  const due = parse(state.followUpDueAt);
  if (due !== null) {
    if (due <= at) raise("followup_overdue", "high");
    else if (due - at <= SOON_MS) raise("followup_due_soon", "normal");
  }
  if (state.leadStatus === "follow_up_due") raise("followup_overdue", "high");

  if (state.leadStatus === "booked") raise("booked_upcoming", "normal");

  // Worth seeing, not worth interrupting for. A good lead with nothing
  // outstanding belongs in the queue and not at the top of it.
  if ((state.qualificationScore ?? 0) >= WELL_QUALIFIED) raise("well_qualified", "normal");

  // The ball is in their court. Not silence - a follow-up still surfaces - but
  // nothing here is urgent while the next move is theirs.
  if (state.leadStatus === "awaiting_customer") cap("awaiting_customer", "normal");

  const snoozed = parse(state.followUpSnoozedUntil);
  // Only a future snooze counts. One whose time has passed is a follow-up that
  // has come back, not a deferral still in force.
  if (snoozed !== null && snoozed > at) cap("followup_snoozed", "low");

  // Nothing may be sent to them, so nothing about them is actionable.
  if (state.optedOut) cap("opted_out", "low");

  if (state.leadStatus === "closed") cap("conversation_closed", "low");

  const raised = reasons
    .filter((reason) => reason.effect === "raises")
    .reduce<AttentionPriority>(
      (highest, reason) => (rank(reason.level) > rank(highest) ? reason.level : highest),
      "low"
    );

  const ceiling = reasons
    .filter((reason) => reason.effect === "caps")
    .reduce<AttentionPriority>(
      (lowest, reason) => (rank(reason.level) < rank(lowest) ? reason.level : lowest),
      "critical"
    );

  const priority = humanRequested ? raised : rank(raised) > rank(ceiling) ? ceiling : raised;

  return { priority, reasons };
}

/** Whether any contact in a list needs looking at today. */
export function hasAttentionSignals(verdicts: readonly AttentionVerdict[]): boolean {
  return verdicts.some((verdict) => rank(verdict.priority) >= rank("high"));
}
