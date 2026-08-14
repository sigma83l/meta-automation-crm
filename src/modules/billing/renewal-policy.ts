/**
 * Pure renewal decisions, deliberately free of I/O so they can be tested.
 *
 * Both rules here previously lived inline inside the charge cron, where no test
 * could reach them. That is how a converted trial came to be re-charged every
 * tick, and how a customer who always paid on time was cancelled at their sixth
 * renewal. Keep these functions pure.
 */

/** Consecutive failed charges tolerated before a subscription is cancelled. */
export const BILLING_MAX_CHARGE_ATTEMPTS = 5;

export type ChargeAttemptStatus = "pending" | "succeeded" | "declined" | "charge_unknown";

/**
 * Builds the PostgREST filter selecting subscriptions that are genuinely due.
 *
 * Each status is matched against the date that actually governs it. Matching
 * both dates against every status — the original behaviour — left a converted
 * trial permanently due, because its `trial_ends_at` is by definition in the
 * past once it has converted.
 */
export function buildDueSubscriptionFilter(nowIso: string): string {
  return [
    `and(status.eq.trialing,trial_ends_at.lte.${nowIso})`,
    `and(status.eq.active,current_period_ends_at.lte.${nowIso})`,
    `and(status.eq.past_due,current_period_ends_at.lte.${nowIso})`
  ].join(",");
}

/**
 * Counts failed charges since the most recent success.
 *
 * `attempts` must be ordered newest first. A `pending` attempt is unresolved —
 * it is not evidence of failure, so it neither increments the count nor ends
 * the run. Anything at or beyond the last success is irrelevant.
 */
export function countConsecutiveFailures(
  attempts: readonly Readonly<{ status: string }>[]
): number {
  let failures = 0;
  for (const attempt of attempts) {
    if (attempt.status === "succeeded") break;
    if (attempt.status === "declined" || attempt.status === "charge_unknown") failures += 1;
  }
  return failures;
}

/**
 * Whether a free trial may be granted.
 *
 * Two independent gates, both of which must pass. The card fingerprint stops
 * one person farming trials across many workspaces; the workspace ledger stops
 * one workspace farming trials across many cards. Keying on the fingerprint
 * alone left the second route wide open — cancel, register a different card,
 * receive a fresh window, repeat.
 */
export function isTrialGrantable(
  fingerprintIsNew: boolean,
  workspaceTrialConsumedAt: string | null
): boolean {
  return fingerprintIsNew && workspaceTrialConsumedAt === null;
}

/** Whether the cap has been reached and the subscription must be cancelled. */
export function hasExhaustedChargeAttempts(consecutiveFailures: number): boolean {
  return consecutiveFailures >= BILLING_MAX_CHARGE_ATTEMPTS;
}

/**
 * The trial end to persist alongside a status transition.
 *
 * A successful charge converts the subscription, and conversion is terminal:
 * the trial end must be cleared or the subscription stays permanently due.
 */
export function trialEndAfterTransition(
  succeeded: boolean,
  currentTrialEndsAt: string | null
): string | null {
  return succeeded ? null : currentTrialEndsAt;
}
