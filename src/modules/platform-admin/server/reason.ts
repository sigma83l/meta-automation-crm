import "server-only";

/**
 * The reason every console action carries, validated in one place.
 *
 * `PLATFORM_ADMIN_CONSOLE.md` says the requirement is enforced in three places —
 * the `ReasonAction` component, the server module, and the ledger that stores
 * what was typed. That was true of the component and the ledger and only
 * loosely true of the middle one: four modules held their own copy of an
 * identical `requireReason`, and two more inlined the same two comparisons with
 * their own wording. Six implementations of one rule is six places for it to
 * drift, and the drift would show up as an action that quietly accepted a
 * thinner reason than its neighbours.
 *
 * The bounds themselves are unchanged. 400 matches the column's check
 * constraint, so a reason that passes here cannot fail at the database.
 */

const MIN_REASON = 3;
const MAX_REASON = 400;

export function requireReason(value: string): string {
  const reason = value.trim();
  if (reason.length < MIN_REASON || reason.length > MAX_REASON) {
    throw new Error(
      `This action needs a reason between ${MIN_REASON} and ${MAX_REASON} characters.`
    );
  }
  return reason;
}

/**
 * A longer minimum, for opening a window onto a customer's data.
 *
 * "asked" clears the ordinary bar and explains nothing to whoever reads the
 * ledger afterwards; the extra characters are the difference between a reason
 * and a formality. The caller supplies the sentence because the refusal should
 * name the thing being done, not the function doing the checking.
 */
export function requireLongReason(value: string, message: string): string {
  const reason = value.trim();
  if (reason.length < 8 || reason.length > MAX_REASON) throw new Error(message);
  return reason;
}
