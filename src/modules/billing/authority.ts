import type { SubscriptionStatus } from "./contracts";
import {
  resolvePlanForPrice,
  type BillingCatalogue,
  type BillingPlan
} from "./providers/paddle/catalogue";
import type { NormalizedBillingEvent } from "./providers/paddle/events";

/**
 * The billing authority: how a verified provider event changes what a workspace
 * is entitled to.
 *
 * The pack states the canonical path as
 * `Checkout → Provider → Verified Webhook → Durable Event → Reconciliation →
 * Entitlement`, and names three things that are never authority: the checkout
 * success page, the client redirect, and browser local state. All three are
 * attacker-controllable — anyone can open the success URL — so nothing in this
 * module accepts input from them. Entitlement moves on verified events only.
 *
 * Pure: it takes a projection and an event and returns the next projection.
 * Persistence and provider I/O live elsewhere, which is what makes the ordering
 * rules below testable at all.
 */

export type SubscriptionProjection = Readonly<{
  status: SubscriptionStatus;
  plan: BillingPlan;
  /** The catalogue version this cycle was priced under. */
  catalogueVersion: string;
  subscriptionRef: string | null;
  /** Access continues to this instant even after cancellation. */
  paidThrough: string | null;
  /** A downgrade agreed now but effective at the renewal boundary. */
  scheduledPlan: BillingPlan | null;
  canceledAt: string | null;
  /** Provider `occurred_at` of the newest event already folded in. */
  lastEventOccurredAt: string | null;
  lastEventRef: string | null;
}>;

export type ApplyRejection =
  /** Already folded in. Duplicates are harmless by design. */
  | "duplicate"
  /** Delivered late; the projection already reflects something newer. */
  | "out_of_order"
  /** Belongs to a different subscription than this projection tracks. */
  | "foreign_subscription"
  /** The price is not in the catalogue, so no plan can be assigned. */
  | "unresolvable_plan";

export type ApplyOutcome =
  | Readonly<{ applied: true; projection: SubscriptionProjection; changed: readonly string[] }>
  | Readonly<{ applied: false; reason: ApplyRejection }>;

const PLAN_RANK: Readonly<Record<BillingPlan, number>> = Object.freeze({
  trial: 0,
  starter: 1,
  growth: 2,
  scale: 3
});

export function isUpgrade(from: BillingPlan, to: BillingPlan): boolean {
  return PLAN_RANK[to] > PLAN_RANK[from];
}

/**
 * Folds one verified event into the projection.
 *
 * Three ordering guards come first, because every one of them has to hold
 * before any state is touched:
 *
 *   duplicate            the same event id twice must be a no-op, since
 *                        providers retry and our own ACK can be lost
 *   out_of_order         webhooks do not arrive in the order they happened;
 *                        `occurred_at` decides, not delivery
 *   foreign_subscription an event for another subscription must never edit
 *                        this one, however well-formed it is
 */
export function applyBillingEvent(
  projection: SubscriptionProjection,
  event: NormalizedBillingEvent,
  catalogue: BillingCatalogue
): ApplyOutcome {
  if (projection.lastEventRef !== null && projection.lastEventRef === event.eventRef) {
    return { applied: false, reason: "duplicate" };
  }

  if (projection.lastEventOccurredAt !== null) {
    const seen = Date.parse(projection.lastEventOccurredAt);
    const incoming = Date.parse(event.occurredAt);
    // Strictly older only. Two events can share a timestamp, and dropping the
    // second would lose a real state change.
    if (incoming < seen) {
      return { applied: false, reason: "out_of_order" };
    }
  }

  if (
    projection.subscriptionRef !== null &&
    event.subscriptionRef !== null &&
    projection.subscriptionRef !== event.subscriptionRef
  ) {
    return { applied: false, reason: "foreign_subscription" };
  }

  const changed: string[] = [];
  const next: {
    -readonly [K in keyof SubscriptionProjection]: SubscriptionProjection[K];
  } = { ...projection };

  next.lastEventRef = event.eventRef;
  next.lastEventOccurredAt = event.occurredAt;

  if (event.subscriptionRef !== null && projection.subscriptionRef === null) {
    next.subscriptionRef = event.subscriptionRef;
    changed.push("subscriptionRef");
  }

  // Paid-through only ever moves forward. A late-arriving event carrying an
  // older period end must not shorten access somebody has already paid for.
  if (event.paidThrough !== null) {
    const incomingEnd = Date.parse(event.paidThrough);
    const currentEnd = projection.paidThrough ? Date.parse(projection.paidThrough) : Number.NaN;
    if (!Number.isFinite(currentEnd) || incomingEnd > currentEnd) {
      next.paidThrough = event.paidThrough;
      changed.push("paidThrough");
    }
  }

  const resolvedPlan = resolvePlanFromEvent(event, catalogue);
  if (resolvedPlan === "unresolvable") {
    // Everything above is safe to keep — ordering, references, paid-through do
    // not depend on the plan — but a status change that implies a plan cannot
    // proceed without one.
    if (event.priceIds.length > 0) {
      return { applied: false, reason: "unresolvable_plan" };
    }
  }

  switch (event.eventType) {
    case "transaction.completed": {
      // The only event that may raise an entitlement. A completed transaction
      // is the sole evidence available here that money actually moved.
      if (event.isPaidEvent && resolvedPlan !== "unresolvable") {
        if (projection.plan !== resolvedPlan) {
          next.plan = resolvedPlan;
          changed.push("plan");
        }
        if (projection.status !== "active") {
          next.status = "active";
          changed.push("status");
        }
        next.catalogueVersion = catalogue.version;
        // A payment landing clears a scheduled downgrade only if it is for the
        // plan being downgraded from; otherwise the schedule still stands.
        if (next.scheduledPlan !== null && next.scheduledPlan === next.plan) {
          next.scheduledPlan = null;
          changed.push("scheduledPlan");
        }
        if (next.canceledAt !== null) {
          next.canceledAt = null;
          changed.push("canceledAt");
        }
      }
      break;
    }

    case "transaction.payment_failed":
    case "subscription.past_due": {
      if (projection.status !== "past_due") {
        next.status = "past_due";
        changed.push("status");
      }
      break;
    }

    case "subscription.created": {
      // Deliberately no status change. Created is the provider acknowledging
      // the object exists, not evidence anybody paid; the reference and
      // paid-through captured above are the whole of what it tells us.
      break;
    }

    case "subscription.activated":
    case "subscription.resumed": {
      // Activation covers trial activation too, so it may not raise a plan on
      // its own. It can only restore a subscription that is already paid for
      // through a future date.
      if (projection.status === "past_due" && hasFutureAccess(next.paidThrough, event.occurredAt)) {
        next.status = "active";
        changed.push("status");
      }
      break;
    }

    case "subscription.updated": {
      if (resolvedPlan === "unresolvable") break;
      if (projection.plan === resolvedPlan) break;
      if (isUpgrade(projection.plan, resolvedPlan)) {
        // An upgrade agreed at the provider is not an upgrade paid for. It
        // takes effect when the transaction completes, not here.
        break;
      }
      // Downgrades take effect at the renewal boundary: the customer has paid
      // through the end of this period and keeps what they bought until then.
      next.scheduledPlan = resolvedPlan;
      changed.push("scheduledPlan");
      break;
    }

    case "subscription.paused":
    case "subscription.canceled": {
      // Cancel is not delete. The subscription stops renewing; access runs to
      // the paid-through date, and the projection records when it was ended so
      // that a later reconciliation can tell "cancelled" from "never existed".
      next.canceledAt = event.occurredAt;
      changed.push("canceledAt");
      if (projection.status !== "canceled") {
        next.status = "canceled";
        changed.push("status");
      }
      break;
    }
  }

  return { applied: true, projection: Object.freeze(next), changed };
}

function resolvePlanFromEvent(
  event: NormalizedBillingEvent,
  catalogue: BillingCatalogue
): BillingPlan | "unresolvable" {
  for (const priceId of event.priceIds) {
    const resolved = resolvePlanForPrice(catalogue, priceId);
    if (resolved.ok) return resolved.value.plan;
  }
  return "unresolvable";
}

function hasFutureAccess(paidThrough: string | null, at: string): boolean {
  if (!paidThrough) return false;
  return Date.parse(paidThrough) > Date.parse(at);
}

/**
 * Applies a scheduled downgrade once the paid period has actually ended.
 *
 * Separate from event handling on purpose: the downgrade is caused by time
 * passing, not by a provider notification, and running it from a webhook would
 * mean a customer who paid for a month lost their plan the moment they clicked
 * "downgrade".
 */
export function applyRenewalBoundary(
  projection: SubscriptionProjection,
  now: Date
): SubscriptionProjection {
  if (projection.scheduledPlan === null) return projection;
  if (!projection.paidThrough) return projection;
  if (Date.parse(projection.paidThrough) > now.getTime()) return projection;
  return Object.freeze({ ...projection, plan: projection.scheduledPlan, scheduledPlan: null });
}

export type AccessRestrictions = Readonly<{
  /** May the workspace read its own data? */
  dataAccess: boolean;
  /** May the workspace send messages to customers? */
  outboundSend: boolean;
  /** May the workspace export? */
  export: boolean;
}>;

/**
 * What a workspace may still do in each state.
 *
 * The pack's rule for past-due is to restrict outbound before data access, and
 * it is the right order: withholding somebody's own customer records over a
 * failed card is punitive and makes the problem harder to fix, whereas pausing
 * outbound stops the bill growing. The same logic runs through every degraded
 * state — data and export survive longest, because they are how a customer
 * leaves if they choose to.
 */
export function accessRestrictionsFor(
  status: SubscriptionStatus,
  hasFuturePaidThrough: boolean
): AccessRestrictions {
  switch (status) {
    case "active":
    case "trialing":
      return { dataAccess: true, outboundSend: true, export: true };
    case "past_due":
      return { dataAccess: true, outboundSend: false, export: true };
    case "canceled":
      // Paid through a future date: they bought it, they keep it.
      return hasFuturePaidThrough
        ? { dataAccess: true, outboundSend: true, export: true }
        : { dataAccess: true, outboundSend: false, export: true };
    case "trial_expired_grace":
      return { dataAccess: true, outboundSend: false, export: true };
    case "suspended":
      // Withdrawn by policy rather than by billing. Export survives so that a
      // suspension is never a way to strand somebody's data.
      return { dataAccess: false, outboundSend: false, export: true };
    case "incomplete":
      return { dataAccess: true, outboundSend: false, export: true };
  }
}
