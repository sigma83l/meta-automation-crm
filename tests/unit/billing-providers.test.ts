import { describe, expect, it } from "vitest";
import {
  authorizeWorkspaceEntitlement,
  embeddedPlanPrice
} from "@/src/modules/billing/entitlement";
import { authorizeLiveBillingAction } from "@/src/modules/billing/live-billing-gate";
import { createFakePaymentProvider } from "@/src/modules/billing/providers/fake-payment-provider";

const sandboxAuthorization = Object.freeze({
  mode: "sandbox" as const,
  environmentEnabled: false,
  explicitApproval: false,
  merchantAllowlisted: false
});

describe("billing entitlement", () => {
  it("authorizes an active subscription inside its paid period, regardless of trial dates", () => {
    const result = authorizeWorkspaceEntitlement({
      status: "active",
      trialEndsAt: null,
      currentPeriodEndsAt: "2026-09-09T00:00:00.000Z",
      now: "2026-08-09T00:00:00.000Z"
    });
    expect(result).toEqual({ ok: true, value: "ACTIVE" });
  });

  it("denies an active subscription whose paid period lapsed beyond the grace window", () => {
    // The defect: 'active' was entitlement forever. If the renewal cron ever
    // stopped, an expired subscription kept full CRM and automation access
    // indefinitely, because the clock was never consulted.
    const result = authorizeWorkspaceEntitlement({
      status: "active",
      trialEndsAt: null,
      currentPeriodEndsAt: "2026-08-01T00:00:00.000Z",
      now: "2026-09-09T00:00:00.000Z"
    });
    expect(result.ok).toBe(false);
  });

  it("keeps an active subscription entitled briefly after expiry", () => {
    // The cron runs every 15 minutes, so a renewal can land just after the
    // boundary. Customers must not lose access over our scheduler latency.
    const result = authorizeWorkspaceEntitlement({
      status: "active",
      trialEndsAt: null,
      currentPeriodEndsAt: "2026-08-09T00:00:00.000Z",
      now: "2026-08-09T06:00:00.000Z"
    });
    expect(result).toEqual({ ok: true, value: "ACTIVE" });
  });

  it("entitles a free plan without consulting any clock", () => {
    // Nothing renews on the free tier, so nothing can expire. Before this a
    // lapsed trial was cancelled outright, which locked somebody out of their
    // own data over a trial they had never paid for.
    const result = authorizeWorkspaceEntitlement({
      status: "active",
      trialEndsAt: "2026-01-01T00:00:00.000Z",
      currentPeriodEndsAt: null,
      planPriceMinorUnits: 0,
      now: "2030-01-01T00:00:00.000Z"
    });
    expect(result).toEqual({ ok: true, value: "FREE" });
  });

  it("does not extend the free tier to somebody who cancelled", () => {
    // Closing the account is a request to be gone. A free tier is not a reason
    // to keep serving them.
    const result = authorizeWorkspaceEntitlement({
      status: "canceled",
      trialEndsAt: null,
      currentPeriodEndsAt: null,
      planPriceMinorUnits: 0,
      now: "2026-09-09T00:00:00.000Z"
    });
    expect(result.ok).toBe(false);
  });

  it("treats an unreadable plan price as paid, not as free", () => {
    // The zero has to be stated. Inferring "free" from a missing price would
    // turn every failed join into unlimited free access.
    const lapsed = {
      status: "active" as const,
      trialEndsAt: null,
      currentPeriodEndsAt: "2026-08-01T00:00:00.000Z",
      now: "2026-09-09T00:00:00.000Z"
    };
    expect(authorizeWorkspaceEntitlement({ ...lapsed, planPriceMinorUnits: null }).ok).toBe(false);
    expect(authorizeWorkspaceEntitlement(lapsed).ok).toBe(false);
  });

  it("reads an embedded plan price in either shape PostgREST returns", () => {
    // Typed as an array, delivered as an object. Anything else is null, so an
    // unreadable embed can never be mistaken for a free plan.
    expect(embeddedPlanPrice([{ price_minor_units: 0 }])).toBe(0);
    expect(embeddedPlanPrice({ price_minor_units: 4500 })).toBe(4500);
    expect(embeddedPlanPrice(null)).toBeNull();
    expect(embeddedPlanPrice([])).toBeNull();
    expect(embeddedPlanPrice({ price_minor_units: "free" })).toBeNull();
  });

  it("denies an active subscription with no recorded period end", () => {
    // Cannot be verified as paid, so it is not entitled.
    const result = authorizeWorkspaceEntitlement({
      status: "active",
      trialEndsAt: null,
      currentPeriodEndsAt: null,
      now: "2026-08-09T00:00:00.000Z"
    });
    expect(result.ok).toBe(false);
  });

  it("authorizes a trial that has not yet expired", () => {
    const now = "2026-08-09T00:00:00.000Z";
    const result = authorizeWorkspaceEntitlement({
      status: "trialing",
      trialEndsAt: "2026-08-10T00:00:00.000Z",
      now
    });
    expect(result).toEqual({ ok: true, value: "TRIALING" });
  });

  it("denies an expired trial and every other non-active status", () => {
    const now = "2026-08-09T00:00:00.000Z";
    const expiredTrial = authorizeWorkspaceEntitlement({
      status: "trialing",
      trialEndsAt: "2026-08-08T00:00:00.000Z",
      now
    });
    expect(expiredTrial.ok).toBe(false);
    if (!expiredTrial.ok) expect(expiredTrial.error.code).toBe("BILLING_ENTITLEMENT_REQUIRED");

    for (const status of ["incomplete", "past_due", "canceled"] as const) {
      const result = authorizeWorkspaceEntitlement({ status, trialEndsAt: null, now });
      expect(result.ok).toBe(false);
    }
  });
});

describe("live billing gate", () => {
  it("allows sandbox mode unconditionally", () => {
    const result = authorizeLiveBillingAction(sandboxAuthorization);
    expect(result).toEqual({ ok: true, value: "SANDBOX" });
  });

  it("fails live billing closed unless every gate is satisfied", () => {
    const result = authorizeLiveBillingAction({
      mode: "live",
      environmentEnabled: false,
      explicitApproval: false,
      merchantAllowlisted: false
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("BILLING_LIVE_BLOCKED");
      expect(result.error.details?.missing).toContain("environment gate");
      expect(result.error.details?.missing).toContain("explicit approval");
      expect(result.error.details?.missing).toContain("merchant allowlist");
    }
  });

  it("unlocks live mode only when every gate is true", () => {
    const result = authorizeLiveBillingAction({
      mode: "live",
      environmentEnabled: true,
      explicitApproval: true,
      merchantAllowlisted: true
    });
    expect(result).toEqual({ ok: true, value: "LIVE" });
  });
});

describe("fake payment provider", () => {
  it("returns the same card fingerprint for the same fixture card across workspaces", async () => {
    const provider = createFakePaymentProvider();
    const first = await provider.verifyCardRegistrationCallback({
      rawBody: new Uint8Array(),
      query: { fixtureCard: "5555" }
    });
    const second = await provider.verifyCardRegistrationCallback({
      rawBody: new Uint8Array(),
      query: { fixtureCard: "5555" }
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.cardFingerprintSource).toBe(second.value.cardFingerprintSource);
    }
  });

  it("declines registration for the reserved decline fixture", async () => {
    const provider = createFakePaymentProvider();
    const result = await provider.verifyCardRegistrationCallback({
      rawBody: new Uint8Array(),
      query: { fixtureCard: "0000" }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BILLING_CARD_REGISTRATION_FAILED");
  });

  it("charges a normal card successfully in sandbox mode", async () => {
    const provider = createFakePaymentProvider();
    const result = await provider.chargeStoredCard({
      providerCustomerRef: "fake-customer-4111",
      providerCardRef: "fake-card-4111",
      amountMinorUnits: 49_900,
      currency: "TRY",
      orderRef: "order-1",
      customerEmail: "owner@example.test",
      userIp: "203.0.113.1",
      authorization: sandboxAuthorization
    });
    expect(result).toEqual({
      ok: true,
      value: { status: "succeeded", providerTransactionRef: "fake-txn-order-1" }
    });
  });

  it("reports an ambiguous outcome for the reserved unknown-outcome fixture", async () => {
    const provider = createFakePaymentProvider();
    const result = await provider.chargeStoredCard({
      providerCustomerRef: "fake-customer-9999",
      providerCardRef: "fake-card-9999",
      amountMinorUnits: 49_900,
      currency: "TRY",
      orderRef: "order-2",
      customerEmail: "owner@example.test",
      userIp: "203.0.113.1",
      authorization: sandboxAuthorization
    });
    expect(result).toEqual({ ok: true, value: { status: "unknown" } });
  });
});
