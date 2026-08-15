/**
 * When a follow-up may be scheduled, and when it must stop.
 *
 * The pack prohibits timer-only sequences, and the reason is worth stating: a
 * message sent because a clock elapsed, rather than because a specific thing is
 * outstanding, is indistinguishable from spam to the person receiving it. Every
 * follow-up here therefore carries why it exists, what would make it
 * unnecessary, and what it is trying to achieve.
 *
 * Pure by design; the columns backing this are in the CRM migration.
 */

export const STOP_REASONS = [
  "waiting_after_answer",
  "price_sent",
  "appointment_proposed",
  "human_promised_response",
  "abandoned_booking",
  "post_service"
] as const;

export type StopReason = (typeof STOP_REASONS)[number];

export type FollowUpPlan = Readonly<{
  stopReason: StopReason;
  objective: string;
  cancelCondition: string;
  messageVersion: string;
  attempts: number;
}>;

export type FollowUpContext = Readonly<{
  /** Has the customer said anything since the follow-up was queued? */
  customerRespondedSince: boolean;
  /** Has the customer opted out of contact? */
  optedOut: boolean;
  /** Has the condition the follow-up was waiting on been satisfied? */
  cancelConditionMet: boolean;
  /** Is the conversation currently owned by a human? */
  humanOwns: boolean;
  /** Is the workspace permitted to send at all? */
  canSend: boolean;
}>;

/** Bounded cadence per reason. Beyond this the silence is the answer. */
export const MAX_ATTEMPTS: Readonly<Record<StopReason, number>> = Object.freeze({
  waiting_after_answer: 2,
  price_sent: 2,
  appointment_proposed: 3,
  // The business promised a person would reply; chasing on their behalf more
  // than once turns a service failure into an annoyance.
  human_promised_response: 1,
  abandoned_booking: 2,
  post_service: 1
});

export type EligibilityVerdict =
  Readonly<{ eligible: true }> | Readonly<{ eligible: false; reason: string; terminal: boolean }>;

/**
 * Whether a queued follow-up should still go out.
 *
 * Evaluated at execution rather than at scheduling: everything relevant can
 * change in between, and the whole point of not being a timer is that the
 * decision is made against the world as it is when the message would be sent.
 */
export function evaluateEligibility(
  plan: FollowUpPlan,
  context: FollowUpContext
): EligibilityVerdict {
  if (plan.objective.trim() === "" || plan.cancelCondition.trim() === "") {
    // Without both, this is a timer wearing a follow-up's clothes.
    return { eligible: false, reason: "objective and cancel condition required", terminal: true };
  }
  if (context.optedOut) {
    return { eligible: false, reason: "customer opted out", terminal: true };
  }
  if (!context.canSend) {
    return { eligible: false, reason: "sending not permitted", terminal: false };
  }
  if (context.cancelConditionMet) {
    return { eligible: false, reason: "cancel condition met", terminal: true };
  }
  if (context.customerRespondedSince) {
    // They answered. Whatever this was chasing is no longer outstanding, and
    // sending anyway is the behaviour that makes automation feel robotic.
    return { eligible: false, reason: "customer already responded", terminal: true };
  }
  if (context.humanOwns && plan.stopReason !== "human_promised_response") {
    return { eligible: false, reason: "conversation owned by a human", terminal: false };
  }
  if (plan.attempts >= MAX_ATTEMPTS[plan.stopReason]) {
    return { eligible: false, reason: "attempt budget exhausted", terminal: true };
  }
  return { eligible: true };
}

/**
 * The objective a follow-up should pursue for its reason.
 *
 * Each is a specific next step rather than a nudge, because "just checking in"
 * carries no information and invites no reply.
 */
export function defaultObjective(reason: StopReason): string {
  switch (reason) {
    case "waiting_after_answer":
      return "check the answer landed and offer the next step";
    case "price_sent":
      return "diagnose whether the obstacle is affordability or value";
    case "appointment_proposed":
      return "offer specific available slots";
    case "human_promised_response":
      return "give an ownership update or an ETA";
    case "abandoned_booking":
      return "resume from the last completed step";
    case "post_service":
      return "check the outcome and offer a relevant next service";
  }
}

export function defaultCancelCondition(reason: StopReason): string {
  switch (reason) {
    case "waiting_after_answer":
      return "customer replies";
    case "price_sent":
      return "customer declines explicitly or withdraws consent";
    case "appointment_proposed":
      return "appointment booked or cancelled";
    case "human_promised_response":
      return "a human replies";
    case "abandoned_booking":
      return "booking completed or abandoned deliberately";
    case "post_service":
      return "customer opts out or the check completes";
  }
}
