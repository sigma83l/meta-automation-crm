import { appError, err, ok, type Result } from "@/src/lib/result";

/**
 * Versioned Paddle product and price mapping.
 *
 * The pack's rule is that product/price mappings come from versioned config and
 * never from scattered constants, and the reason is auditability: an invoice
 * raised last March has to be explicable in terms of what the catalogue said in
 * March, not what it says today. So each catalogue is immutable once published
 * and a new one gets a new version; a billing cycle records the version it was
 * priced under.
 *
 * TEMPLATE. The price identifiers below are placeholders because the Paddle
 * account does not exist yet. They are deliberately shaped so that they cannot
 * be mistaken for real ones (`pri_PLACEHOLDER_*`), and `resolvePlanForPrice`
 * refuses to resolve them, so wiring a live webhook to an unfilled catalogue
 * fails loudly at the first event instead of silently entitling a workspace to
 * a plan nobody bought.
 *
 * To go live: create the products and prices in Paddle, then add a new version
 * with the real `pri_...` identifiers. Do not edit v1 in place — that is the
 * whole point of the version.
 */

export const BILLING_PLANS = ["trial", "starter", "growth", "scale"] as const;

export type BillingPlan = (typeof BILLING_PLANS)[number];

export type PlanEntitlements = Readonly<{
  seats: number;
  monthlyActiveContacts: number;
  aiRepliesPerCycle: number;
  automationActionsPerCycle: number;
  mediaBytes: number;
  liveConnections: number;
  broadcastEnabled: boolean;
  apiAccessEnabled: boolean;
}>;

export type CataloguePrice = Readonly<{
  plan: Exclude<BillingPlan, "trial">;
  /** Paddle price id. Placeholder until the account exists. */
  priceId: string;
  /** Paddle product id. Placeholder until the account exists. */
  productId: string;
  billingInterval: "month" | "year";
  amountMinorUnits: number;
  currency: string;
}>;

export type BillingCatalogue = Readonly<{
  version: string;
  publishedAt: string;
  prices: readonly CataloguePrice[];
  entitlements: Readonly<Record<BillingPlan, PlanEntitlements>>;
}>;

/** A placeholder identifier is one that has not been filled in from a real account. */
export function isPlaceholderIdentifier(identifier: string): boolean {
  return identifier.includes("PLACEHOLDER");
}

/**
 * Trial entitlements are the V1 limits from the pack, and they are part of the
 * catalogue rather than free-floating constants for the same reason prices are:
 * when a trial's limits change, workspaces already mid-trial must keep being
 * measured against the limits they started under.
 */
const TRIAL_ENTITLEMENTS: PlanEntitlements = Object.freeze({
  seats: 2,
  monthlyActiveContacts: 100,
  aiRepliesPerCycle: 150,
  automationActionsPerCycle: 300,
  mediaBytes: 100 * 1024 * 1024,
  liveConnections: 1,
  broadcastEnabled: false,
  apiAccessEnabled: false
});

export const CATALOGUE_V1: BillingCatalogue = Object.freeze({
  version: "v1",
  publishedAt: "2026-08-15T00:00:00.000Z",
  prices: Object.freeze([
    Object.freeze({
      plan: "starter" as const,
      priceId: "pri_PLACEHOLDER_starter_monthly",
      productId: "pro_PLACEHOLDER_starter",
      billingInterval: "month" as const,
      amountMinorUnits: 0,
      currency: "USD"
    }),
    Object.freeze({
      plan: "growth" as const,
      priceId: "pri_PLACEHOLDER_growth_monthly",
      productId: "pro_PLACEHOLDER_growth",
      billingInterval: "month" as const,
      amountMinorUnits: 0,
      currency: "USD"
    }),
    Object.freeze({
      plan: "scale" as const,
      priceId: "pri_PLACEHOLDER_scale_monthly",
      productId: "pro_PLACEHOLDER_scale",
      billingInterval: "month" as const,
      amountMinorUnits: 0,
      currency: "USD"
    })
  ]),
  entitlements: Object.freeze({
    trial: TRIAL_ENTITLEMENTS,
    starter: Object.freeze({
      seats: 3,
      monthlyActiveContacts: 1_000,
      aiRepliesPerCycle: 2_000,
      automationActionsPerCycle: 5_000,
      mediaBytes: 5 * 1024 * 1024 * 1024,
      liveConnections: 2,
      broadcastEnabled: false,
      apiAccessEnabled: false
    }),
    growth: Object.freeze({
      seats: 10,
      monthlyActiveContacts: 5_000,
      aiRepliesPerCycle: 10_000,
      automationActionsPerCycle: 25_000,
      mediaBytes: 25 * 1024 * 1024 * 1024,
      liveConnections: 5,
      broadcastEnabled: true,
      apiAccessEnabled: true
    }),
    scale: Object.freeze({
      seats: 25,
      monthlyActiveContacts: 25_000,
      aiRepliesPerCycle: 50_000,
      automationActionsPerCycle: 100_000,
      mediaBytes: 100 * 1024 * 1024 * 1024,
      liveConnections: 15,
      broadcastEnabled: true,
      apiAccessEnabled: true
    })
  })
});

const CATALOGUES: Readonly<Record<string, BillingCatalogue>> = Object.freeze({
  v1: CATALOGUE_V1
});

export const CURRENT_CATALOGUE_VERSION = "v1";

/**
 * Looks up the catalogue a cycle was priced under.
 *
 * Fails rather than falling back to the current version: silently repricing a
 * historical cycle against today's catalogue is how a reconciliation report
 * comes out clean while the invoices disagree.
 */
export function catalogueForVersion(version: string): Result<BillingCatalogue> {
  const catalogue = CATALOGUES[version];
  if (!catalogue) {
    return err(
      appError("CONFIGURATION_MISSING", `No billing catalogue for version ${version}.`, {
        details: { version }
      })
    );
  }
  return ok(catalogue);
}

/**
 * Maps a Paddle price id onto a plan.
 *
 * Refuses placeholders. An unfilled catalogue in front of a live webhook would
 * otherwise entitle a workspace to a plan nobody bought, and that error is both
 * silent and expensive.
 */
export function resolvePlanForPrice(
  catalogue: BillingCatalogue,
  priceId: string
): Result<CataloguePrice> {
  if (isPlaceholderIdentifier(priceId)) {
    return err(
      appError("CONFIGURATION_MISSING", "The billing catalogue still contains placeholder ids.", {
        details: { version: catalogue.version }
      })
    );
  }
  const price = catalogue.prices.find((candidate) => candidate.priceId === priceId);
  if (!price) {
    // An unknown price is not necessarily an attack — it is what a price
    // created in the Paddle dashboard and never added here looks like — but it
    // is never safe to guess a plan from it.
    return err(
      appError("BILLING_PRICE_UNKNOWN", "This price is not in the billing catalogue.", {
        details: { version: catalogue.version }
      })
    );
  }
  return ok(price);
}

export function entitlementsForPlan(
  catalogue: BillingCatalogue,
  plan: BillingPlan
): PlanEntitlements {
  return catalogue.entitlements[plan];
}

/** Whether this catalogue is safe to run a live account against. */
export function isCatalogueReadyForLive(catalogue: BillingCatalogue): boolean {
  return (
    catalogue.prices.length > 0 &&
    catalogue.prices.every(
      (price) =>
        !isPlaceholderIdentifier(price.priceId) &&
        !isPlaceholderIdentifier(price.productId) &&
        price.amountMinorUnits > 0
    )
  );
}
