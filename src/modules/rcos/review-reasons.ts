/**
 * The reason codes a person is allowed to be shown a sentence for.
 *
 * Split out of `server/turn-review-read-model.ts` so a client component can ask
 * the same question the inbox asks. The read model still re-exports these, so
 * there is one list and one answer no matter which surface is explaining a
 * refusal.
 *
 * Reason codes are internal identifiers. They are mapped to sentences at the
 * edge rather than stored as prose, because they are also matched on in tests
 * and in the engine, and a table of translations is not something to duplicate
 * per locale in the database.
 */

/** Codes a surface can explain. Anything else is shown as itself. */
export const REVIEW_REASONS = [
  // From the validator.
  "empty_draft",
  "ungrounded_claim",
  "unverified_money",
  "unverified_time",
  "unclaimed_success",
  "pii_leak",
  "policy_violation",
  "pressure_tactic",
  "duplicate_send",
  // From the decision port.
  "escalation_keyword",
  "low_confidence",
  // From the policy port.
  "human_takeover",
  "conversation_closed",
  "conversation_missing",
  "billing_entitlement_required",
  "ai_replies_disabled",
  "ai_replies_paused"
] as const;

export type ReviewReason = (typeof REVIEW_REASONS)[number];

export function isReviewReason(value: string): value is ReviewReason {
  return (REVIEW_REASONS as readonly string[]).includes(value);
}
