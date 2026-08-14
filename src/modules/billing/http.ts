import { NextResponse } from "next/server";
import { BillingEntitlementError } from "./entitlement-gate";

/**
 * Every gated route's catch block calls this instead of returning its own
 * generic error status, so a blocked trial/subscription surfaces as 402
 * with a specific code rather than being indistinguishable from any other
 * failure (auth, validation, provider outage).
 */
export function billingBlockedResponse(error: unknown, fallbackCode: string, fallbackStatus = 403) {
  if (error instanceof BillingEntitlementError) {
    return NextResponse.json(
      { error: "BILLING_ENTITLEMENT_REQUIRED", status: error.status },
      { status: 402 }
    );
  }
  return NextResponse.json({ error: fallbackCode }, { status: fallbackStatus });
}
