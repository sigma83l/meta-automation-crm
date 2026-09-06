/**
 * What an AI decision is permitted to carry out on its own.
 *
 * The governing rule from the pack is that a language model is never the
 * authority for money, time, availability, booking, payment, entitlement,
 * workspace or role. Expressing that as a classification rather than as
 * scattered conditionals means a new tool has to declare its class, and a tool
 * whose class is unknown is refused instead of quietly allowed.
 *
 * Pure by design: no I/O, no provider calls, so the rules are testable and
 * cannot drift with infrastructure.
 */

export const ACTION_CLASSES = [
  /** Approved prices, opening hours, stored CRM facts. Nothing changes. */
  "read_only",
  /** Tags, inferred fields, task creation. Undoable, but must be audited. */
  "reversible_low_risk",
  /** Booking a slot, creating a payment link. Real-world consequence. */
  "business_transaction",
  /** Refunds, large discounts, medical or legal promises. */
  "sensitive_exception",
  /** Deleting data, revoking accounts. */
  "destructive"
] as const;

export type ActionClass = (typeof ACTION_CLASSES)[number];

export type ActionRequirement = Readonly<{
  /** May the model perform this without a human in the loop? */
  autonomous: boolean;
  /** Must an audit row be written whenever this runs? */
  audited: boolean;
  /** Must the caller supply an idempotency key? */
  idempotencyKey: boolean;
  /** Must an authoritative system confirm the outcome before it is claimed? */
  providerConfirmation: boolean;
  /** Must a human approve before execution? */
  humanApproval: boolean;
}>;

const REQUIREMENTS: Readonly<Record<ActionClass, ActionRequirement>> = Object.freeze({
  read_only: {
    autonomous: true,
    audited: false,
    idempotencyKey: false,
    providerConfirmation: false,
    humanApproval: false
  },
  reversible_low_risk: {
    autonomous: true,
    audited: true,
    idempotencyKey: false,
    providerConfirmation: false,
    humanApproval: false
  },
  business_transaction: {
    // Autonomous, but only under conditions the caller must satisfy: verified
    // inputs, an idempotency key, and an authoritative confirmation before the
    // outcome is stated to a customer.
    autonomous: true,
    audited: true,
    idempotencyKey: true,
    providerConfirmation: true,
    humanApproval: false
  },
  sensitive_exception: {
    autonomous: false,
    audited: true,
    idempotencyKey: true,
    providerConfirmation: true,
    humanApproval: true
  },
  destructive: {
    autonomous: false,
    audited: true,
    idempotencyKey: true,
    providerConfirmation: true,
    humanApproval: true
  }
});

export function requirementsFor(actionClass: ActionClass): ActionRequirement {
  return REQUIREMENTS[actionClass];
}

export type ActionAttempt = Readonly<{
  actionClass: ActionClass;
  /** Actions the workspace policy currently permits for this turn. */
  allowedActions: readonly string[];
  actionName: string;
  hasIdempotencyKey: boolean;
  hasHumanApproval: boolean;
  /** Whether an authoritative system has already confirmed the outcome. */
  hasAuthoritativeResult: boolean;
}>;

export type ActionVerdict =
  Readonly<{ permitted: true; audited: boolean }> | Readonly<{ permitted: false; reason: string }>;

/**
 * Decides whether one attempted action may proceed.
 *
 * Fails closed at every branch: an action the policy did not list, a class that
 * needs approval without one, or a transaction lacking its idempotency key is
 * refused rather than downgraded.
 */
export function authorizeAction(attempt: ActionAttempt): ActionVerdict {
  const requirement = REQUIREMENTS[attempt.actionClass];
  if (!requirement) {
    return { permitted: false, reason: "unknown action class" };
  }

  // The workspace policy for this turn is the outer bound. A model naming an
  // action outside it is attempting to widen its own permissions.
  if (!attempt.allowedActions.includes(attempt.actionName)) {
    return { permitted: false, reason: "action not permitted by policy" };
  }

  if (requirement.humanApproval && !attempt.hasHumanApproval) {
    return { permitted: false, reason: "human approval required" };
  }

  if (requirement.idempotencyKey && !attempt.hasIdempotencyKey) {
    return { permitted: false, reason: "idempotency key required" };
  }

  return { permitted: true, audited: requirement.audited };
}

/**
 * Whether the outcome of an action may be stated to a customer.
 *
 * The fail-safe from the pack: with no authoritative result, do not claim
 * success. Saying "you're booked" on the strength of a model's own output is
 * the failure this prevents.
 */
export function mayClaimSuccess(attempt: ActionAttempt): boolean {
  const requirement = REQUIREMENTS[attempt.actionClass];
  if (!requirement) return false;
  if (!requirement.providerConfirmation) return true;
  return attempt.hasAuthoritativeResult;
}
