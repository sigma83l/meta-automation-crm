import { appError, err, ok, type Result } from "@/src/lib/result";

export type BillingActionAuthorization = Readonly<{
  mode: "sandbox" | "live";
  environmentEnabled: boolean;
  explicitApproval: boolean;
  merchantAllowlisted: boolean;
}>;

export function authorizeLiveBillingAction(
  input: BillingActionAuthorization
): Result<"SANDBOX" | "LIVE"> {
  if (input.mode === "sandbox") {
    return ok("SANDBOX");
  }

  const missing = [
    !input.environmentEnabled ? "environment gate" : null,
    !input.explicitApproval ? "explicit approval" : null,
    !input.merchantAllowlisted ? "merchant allowlist" : null
  ].filter((value): value is string => value !== null);

  if (missing.length > 0) {
    return err(
      appError("BILLING_LIVE_BLOCKED", "Live billing action is blocked.", {
        details: { missing: missing.join(", ") }
      })
    );
  }

  return ok("LIVE");
}
