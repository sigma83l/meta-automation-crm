import { describe, expect, it } from "vitest";
import {
  BILLING_ACKNOWLEDGEMENT_BODY,
  allowsProviderWebhook
} from "@/src/modules/billing/webhook-policy";

describe("billing webhook acknowledgement", () => {
  it("acknowledges with exactly the literal PayTR expects", () => {
    // PayTR treats any other body as a failed notification and retries it,
    // which previously happened for every correctly processed notification
    // because the route answered with JSON.
    expect(BILLING_ACKNOWLEDGEMENT_BODY).toBe("OK");
  });
});

describe("synthetic webhook admission", () => {
  it("permits the fake provider only on a local developer machine", () => {
    expect(allowsProviderWebhook("fake", "local")).toBe(true);
  });

  it("refuses the fake provider in preview and production", () => {
    // The fake provider verifies no signature, the route is public, and a
    // member can read their own charge-attempt id — so accepting this anywhere
    // deployed would let any workspace member self-activate.
    expect(allowsProviderWebhook("fake", "preview")).toBe(false);
    expect(allowsProviderWebhook("fake", "production")).toBe(false);
  });

  it("always permits the real provider, which verifies its own signature", () => {
    for (const mode of ["local", "preview", "production"] as const) {
      expect(allowsProviderWebhook("paytr", mode)).toBe(true);
    }
  });

  it("fails closed for any unrecognised provider name in a deployed mode", () => {
    // Defensive: only a provider that verifies signatures should ever be
    // admitted deployed. An unknown name must not inherit fake's exemption.
    expect(allowsProviderWebhook("fake", "production")).toBe(false);
  });
});
