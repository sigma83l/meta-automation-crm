import { NextResponse } from "next/server";

import { FeatureNotEnabledError } from "./server/gate";

/**
 * A capability this workspace is not entitled to.
 *
 * 403 with its own code rather than 402: this is not "pay us and it unlocks",
 * which is what the billing gate already says with `BILLING_ENTITLEMENT_REQUIRED`.
 * A flag that is off may be off because the plan excludes it, because staff
 * turned it off for this customer, or because the capability is being retired —
 * and none of those are fixed by a payment, so offering the payment screen
 * would send the customer somewhere that cannot help them.
 */
export function featureBlockedResponse(flagKey: string) {
  return NextResponse.json({ error: "FEATURE_NOT_ENABLED", feature: flagKey }, { status: 403 });
}

/**
 * The same 403 for a refusal that arrived as a thrown error from deeper in a
 * module. Returns null for anything else, so a caller can fall through to
 * whatever it already does with an unrecognised failure.
 */
export function featureErrorResponse(error: unknown) {
  return error instanceof FeatureNotEnabledError ? featureBlockedResponse(error.featureKey) : null;
}

/**
 * A capability the platform has switched off for everybody.
 *
 * 503, because unlike the above this is temporary and is nothing to do with the
 * caller: retrying later is the correct response, and a 4xx would tell them to
 * change something about the request instead.
 */
export function platformBlockedResponse(switchKey: string) {
  return NextResponse.json(
    { error: "TEMPORARILY_UNAVAILABLE", capability: switchKey },
    { status: 503 }
  );
}
