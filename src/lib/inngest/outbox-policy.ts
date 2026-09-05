/**
 * The relay's give-up rule, in one place.
 *
 * The ceiling was the literal `10` written three times — twice in the relay's
 * claim filter and once in the console's "past retry limit" count — which is
 * how the console came to offer a requeue action that could not move the rows
 * it was counting. Two of the three would have had to change together for that
 * to work, and nothing said so.
 */

/**
 * A row is claimed while `attempts` is below this. At or above it the relay has
 * given up, and only a person can decide whether the work should run again.
 */
export const OUTBOX_ATTEMPT_CEILING = 10;

/**
 * How many fresh tries a staff-initiated retry buys.
 *
 * Small on purpose. Resetting `attempts` to zero would hand a permanently
 * failing row an unbounded loop, which is exactly what the ceiling exists to
 * stop; leaving `attempts` alone — the original behaviour — means the retry
 * moves nothing at all, because the relay's filter never looks at the row
 * again. A few tries is the only answer that is neither.
 */
export const OUTBOX_RETRY_GRANT = 3;

/**
 * What `attempts` becomes when staff retry a stuck row.
 *
 * Never raises the counter: a row that failed twice keeps its eight remaining
 * tries rather than being cut down to three by somebody pressing a button that
 * was meant to help it.
 */
export function attemptsAfterManualRetry(attempts: number): number {
  const floor = Math.max(OUTBOX_ATTEMPT_CEILING - OUTBOX_RETRY_GRANT, 0);
  return Math.min(Number.isFinite(attempts) ? attempts : floor, floor);
}
