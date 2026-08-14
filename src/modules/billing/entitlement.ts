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

export type EntitlementInput = Readonly<{
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEndsAt?: string | null;
  now?: string;
}>;

export function authorizeWorkspaceEntitlement(
  input: EntitlementInput
): Result<"TRIALING" | "ACTIVE"> {
  const now = input.now ? new Date(input.now) : new Date();

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
