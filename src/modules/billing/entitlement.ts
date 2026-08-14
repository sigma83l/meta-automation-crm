import { appError, err, ok, type Result } from "@/src/lib/result";
import type { SubscriptionStatus } from "./contracts";

export type EntitlementInput = Readonly<{
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  now?: string;
}>;

export function authorizeWorkspaceEntitlement(
  input: EntitlementInput
): Result<"TRIALING" | "ACTIVE"> {
  const now = input.now ? new Date(input.now) : new Date();

  if (input.status === "active") {
    return ok("ACTIVE");
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
