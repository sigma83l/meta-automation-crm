import { appError, err, ok, type Result } from "@/src/lib/result";
import type { SubscriptionStatus } from "./contracts";

/**
 * Grace allowed after a paid period ends before access is withdrawn.
 *
 * The renewal cron runs every 15 minutes, so a renewal can legitimately land a
 * little after expiry; revoking at the exact boundary would lock out paying
 * customers over our own scheduler latency. It is deliberately finite: an
 * unbounded allowance is what made a stalled cron grant access forever.
 */
export const ENTITLEMENT_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * The plan a lapsed trial lands on.
 *
 * Named once rather than typed at each use: the renewal job looks the row up by
 * this key, and a typo there would silently cancel instead of downgrade.
 */
export const FREE_PLAN_KEY = "free_monthly";

export type EntitlementInput = Readonly<{
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEndsAt?: string | null;
  /**
   * The price of the plan this workspace sits on, in minor units.
   *
   * Present so a free plan can be told from a paid one. A free plan does not
   * renew and therefore has no period end, and the `active` branch below
   * refuses an absent period end on purpose - that refusal is what stopped a
   * stalled renewal cron granting paid access forever. Reading "no period end"
   * as "entitled" would reopen exactly that hole, so the zero price has to be
   * stated rather than inferred.
   *
   * Undefined means unknown, which is treated as paid: a caller that cannot say
   * gets the stricter answer.
   */
  planPriceMinorUnits?: number | null;
  now?: string;
}>;

/**
 * Reads the plan price out of an embedded `subscription_plans` row.
 *
 * PostgREST types a one-to-one embed as an array, and returns it as an object
 * at runtime, so every call site needs the same two-shape read. Returning null
 * for anything unrecognised is deliberate: an unreadable price must not be
 * mistaken for a free one, and `authorizeWorkspaceEntitlement` treats null as
 * paid.
 */
export function embeddedPlanPrice(embedded: unknown): number | null {
  const row = Array.isArray(embedded) ? embedded[0] : embedded;
  if (!row || typeof row !== "object") return null;
  const price = (row as { price_minor_units?: unknown }).price_minor_units;
  return typeof price === "number" ? price : null;
}

export function authorizeWorkspaceEntitlement(
  input: EntitlementInput
): Result<"TRIALING" | "ACTIVE" | "FREE"> {
  const now = input.now ? new Date(input.now) : new Date();

  // The free tier, which a lapsed trial lands on rather than being cut off.
  // Checked before everything else because it is the one plan whose
  // entitlement does not depend on a clock at all: nothing renews, so nothing
  // can expire. `canceled` is still excluded - somebody who closed the account
  // asked to be gone, and a free tier is not a reason to keep them.
  if (input.planPriceMinorUnits === 0 && input.status !== "canceled") {
    return ok("FREE");
  }

  if (input.status === "active") {
    // 'active' alone used to be entitlement forever: the period end was never
    // consulted, so if the renewal cron ever stopped running (a rotated Inngest
    // key, a deregistered function) an expired subscription kept full access
    // indefinitely. The clock is now part of the decision.
    const periodEnd = input.currentPeriodEndsAt
      ? new Date(input.currentPeriodEndsAt).getTime()
      : Number.NaN;
    if (Number.isFinite(periodEnd) && periodEnd + ENTITLEMENT_GRACE_MS > now.getTime()) {
      return ok("ACTIVE");
    }
    return err(
      appError("BILLING_ENTITLEMENT_REQUIRED", "An active subscription or trial is required.", {
        details: { status: input.status }
      })
    );
  }
  if (
    input.status === "trialing" &&
    input.trialEndsAt !== null &&
    new Date(input.trialEndsAt).getTime() > now.getTime()
  ) {
    return ok("TRIALING");
  }

  return err(
    appError("BILLING_ENTITLEMENT_REQUIRED", "An active subscription or trial is required.", {
      details: { status: input.status }
    })
  );
}
