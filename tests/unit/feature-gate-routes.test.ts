import { describe, expect, it } from "vitest";

import { featureBlockedResponse, platformBlockedResponse } from "@/src/modules/features/http";

/**
 * What a blocked capability tells the caller.
 *
 * The two refusals are deliberately different statuses, and the distinction is
 * the whole content of this file: one says "not for you", the other says "not
 * right now". Collapsing them — which is what a single generic 403 would do —
 * sends a customer to the billing page for an outage, or tells them to retry
 * something that will refuse them identically forever.
 */

describe("featureBlockedResponse", () => {
  it("answers 403 and names the capability", async () => {
    const response = featureBlockedResponse("crm_export");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "FEATURE_NOT_ENABLED",
      feature: "crm_export"
    });
  });

  it("is not the billing refusal", async () => {
    // 402 is `BILLING_ENTITLEMENT_REQUIRED`, which the client turns into a
    // payment prompt. A flag staff switched off for this customer is not fixed
    // by a payment, so it must never arrive as one.
    const response = featureBlockedResponse("ai_replies");
    expect(response.status).not.toBe(402);
    expect((await response.json()).error).not.toBe("BILLING_ENTITLEMENT_REQUIRED");
  });
});

describe("platformBlockedResponse", () => {
  it("answers 503, because retrying later is the right move", async () => {
    const response = platformBlockedResponse("crm_imports");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "TEMPORARILY_UNAVAILABLE",
      capability: "crm_imports"
    });
  });

  it("says nothing about the caller's entitlement", async () => {
    // A global switch is about us. Reporting it as a 4xx would tell the caller
    // to change something about their request, which is the one thing that
    // cannot help.
    const response = platformBlockedResponse("public_signup");
    expect(response.status).toBeGreaterThanOrEqual(500);
  });
});
