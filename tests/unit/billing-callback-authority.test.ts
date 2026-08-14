import { describe, expect, it } from "vitest";
import { createFakePaymentProvider } from "@/src/modules/billing/providers/fake-payment-provider";
import { createPaytrPaymentProvider } from "@/src/modules/billing/providers/paytr-payment-provider";

/**
 * Regression coverage for the card-registration callback authority rule.
 *
 * The defect these guard against: the PayTR adapter used to read
 * `utoken`/`ctoken`/`card_last4` straight out of the redirect query string and
 * return them as a stored card. Because the redirect carries no hash and no
 * server-side confirmation, a signed-in Owner/Admin could skip PayTR entirely,
 * hit the callback with a random `ctoken`, and be granted a trial with no
 * payment instrument at all — repeatably, with a fresh random value each time.
 */

const syntheticPaytrCredentials = Object.freeze({
  merchantId: "synthetic-merchant-id",
  merchantKey: "synthetic-merchant-key-value",
  merchantSalt: "synthetic-merchant-salt-value"
});

const callbackInput = (query: Record<string, string>) =>
  Object.freeze({ rawBody: new Uint8Array(), query: Object.freeze(query) });

describe("card registration callback authority", () => {
  it("declares the PayTR redirect as non-authoritative", () => {
    const provider = createPaytrPaymentProvider(syntheticPaytrCredentials);
    expect(provider.callbackAuthority).toBe("requires_provider_confirmation");
  });

  it("declares the closed-loop fake provider as authoritative", () => {
    expect(createFakePaymentProvider().callbackAuthority).toBe("authoritative");
  });

  it("refuses to mint a PayTR card from a well-formed but unauthenticated redirect", async () => {
    const provider = createPaytrPaymentProvider(syntheticPaytrCredentials);

    // Exactly the shape the old code accepted: every field present and
    // plausible. It must still be rejected, because none of it is signed.
    const result = await provider.verifyCardRegistrationCallback(
      callbackInput({
        utoken: "attacker-chosen-user-token",
        ctoken: "attacker-chosen-card-token",
        card_last4: "4242",
        card_brand: "visa"
      })
    );

    expect(result.ok).toBe(false);
  });

  it("refuses an empty PayTR redirect just as firmly", async () => {
    const provider = createPaytrPaymentProvider(syntheticPaytrCredentials);
    const result = await provider.verifyCardRegistrationCallback(callbackInput({}));
    expect(result.ok).toBe(false);
  });

  it("never leaks redirect-supplied token values back to the caller", async () => {
    const provider = createPaytrPaymentProvider(syntheticPaytrCredentials);
    const result = await provider.verifyCardRegistrationCallback(
      callbackInput({ utoken: "leak-probe-utoken", ctoken: "leak-probe-ctoken" })
    );

    expect(result.ok).toBe(false);
    // A rejection that echoed the supplied token back would hand an attacker a
    // confirmation oracle; the message must stay generic.
    expect(JSON.stringify(result)).not.toContain("leak-probe");
  });
});
