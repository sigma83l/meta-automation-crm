import { describe, expect, it } from "vitest";
import {
  BILLING_PLANS,
  CATALOGUE_V1,
  CURRENT_CATALOGUE_VERSION,
  catalogueForVersion,
  entitlementsForPlan,
  isCatalogueReadyForLive,
  isPlaceholderIdentifier,
  resolvePlanForPrice,
  type BillingCatalogue
} from "@/src/modules/billing/providers/paddle/catalogue";

/** A catalogue as it will look once the Paddle account exists. */
const filled: BillingCatalogue = {
  ...CATALOGUE_V1,
  version: "test",
  prices: [
    {
      plan: "starter",
      priceId: "pri_01hz_starter",
      productId: "pro_01hz_starter",
      billingInterval: "month",
      amountMinorUnits: 2900,
      currency: "USD"
    },
    {
      plan: "growth",
      priceId: "pri_01hz_growth",
      productId: "pro_01hz_growth",
      billingInterval: "month",
      amountMinorUnits: 7900,
      currency: "USD"
    }
  ]
};

describe("the catalogue is versioned", () => {
  it("resolves the version a cycle was priced under", () => {
    const found = catalogueForVersion(CURRENT_CATALOGUE_VERSION);
    expect(found.ok && found.value.version).toBe("v1");
  });

  it("refuses an unknown version rather than using today's prices", () => {
    // Repricing a historical cycle against the current catalogue is how a
    // reconciliation report comes out clean while the invoices disagree.
    const found = catalogueForVersion("v99");
    expect(found.ok).toBe(false);
    expect(!found.ok && found.error.code).toBe("CONFIGURATION_MISSING");
  });

  it("is frozen, so a published version cannot be edited in place", () => {
    expect(Object.isFrozen(CATALOGUE_V1)).toBe(true);
    expect(Object.isFrozen(CATALOGUE_V1.entitlements)).toBe(true);
  });
});

describe("placeholders cannot entitle anybody", () => {
  it("ships v1 with placeholders, since there is no account yet", () => {
    expect(CATALOGUE_V1.prices.every((price) => isPlaceholderIdentifier(price.priceId))).toBe(true);
  });

  it("refuses to resolve a placeholder price", () => {
    // An unfilled catalogue in front of a live webhook would otherwise entitle
    // a workspace to a plan nobody bought.
    const resolved = resolvePlanForPrice(CATALOGUE_V1, "pri_PLACEHOLDER_growth_monthly");
    expect(resolved.ok).toBe(false);
    expect(!resolved.ok && resolved.error.code).toBe("CONFIGURATION_MISSING");
  });

  it("reports v1 as not ready for a live account", () => {
    expect(isCatalogueReadyForLive(CATALOGUE_V1)).toBe(false);
  });

  it("reports a filled catalogue as ready", () => {
    expect(isCatalogueReadyForLive(filled)).toBe(true);
  });

  it("still refuses a filled catalogue priced at zero", () => {
    expect(
      isCatalogueReadyForLive({
        ...filled,
        prices: filled.prices.map((price) => ({ ...price, amountMinorUnits: 0 }))
      })
    ).toBe(false);
  });
});

describe("price resolution", () => {
  it("maps a known price onto its plan", () => {
    const resolved = resolvePlanForPrice(filled, "pri_01hz_growth");
    expect(resolved.ok && resolved.value.plan).toBe("growth");
    expect(resolved.ok && resolved.value.amountMinorUnits).toBe(7900);
  });

  it("refuses a price created in the dashboard but never added here", () => {
    // Not necessarily an attack, but never safe to guess a plan from.
    const resolved = resolvePlanForPrice(filled, "pri_01hz_invented");
    expect(resolved.ok).toBe(false);
    expect(!resolved.ok && resolved.error.code).toBe("BILLING_PRICE_UNKNOWN");
  });
});

describe("entitlements", () => {
  it("defines limits for every plan including trial", () => {
    for (const plan of BILLING_PLANS) {
      expect(`${plan}:${typeof entitlementsForPlan(CATALOGUE_V1, plan).seats}`).toBe(
        `${plan}:number`
      );
    }
  });

  it("carries the V1 trial limits from the pack", () => {
    const trial = entitlementsForPlan(CATALOGUE_V1, "trial");
    expect(trial).toMatchObject({
      seats: 2,
      monthlyActiveContacts: 100,
      aiRepliesPerCycle: 150,
      automationActionsPerCycle: 300,
      mediaBytes: 100 * 1024 * 1024,
      liveConnections: 1,
      broadcastEnabled: false,
      apiAccessEnabled: false
    });
  });

  it("never gives a trial more than a paid plan", () => {
    const trial = entitlementsForPlan(CATALOGUE_V1, "trial");
    for (const plan of ["starter", "growth", "scale"] as const) {
      const paid = entitlementsForPlan(CATALOGUE_V1, plan);
      expect(`${plan}:${paid.aiRepliesPerCycle >= trial.aiRepliesPerCycle}`).toBe(`${plan}:true`);
      expect(`${plan}:${paid.seats >= trial.seats}`).toBe(`${plan}:true`);
    }
  });
});
