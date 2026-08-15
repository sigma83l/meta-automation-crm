import { describe, expect, it } from "vitest";
import {
  accessRestrictionsFor,
  applyBillingEvent,
  applyRenewalBoundary,
  isUpgrade,
  type SubscriptionProjection
} from "@/src/modules/billing/authority";
import {
  CATALOGUE_V1,
  type BillingCatalogue
} from "@/src/modules/billing/providers/paddle/catalogue";
import { normalizePaddleEvent } from "@/src/modules/billing/providers/paddle/events";
import type { NormalizedBillingEvent } from "@/src/modules/billing/providers/paddle/events";

/** A catalogue with the placeholders filled, as it will look once live. */
const catalogue: BillingCatalogue = {
  ...CATALOGUE_V1,
  version: "test",
  prices: [
    {
      plan: "starter",
      priceId: "pri_starter",
      productId: "pro_starter",
      billingInterval: "month",
      amountMinorUnits: 2900,
      currency: "USD"
    },
    {
      plan: "growth",
      priceId: "pri_growth",
      productId: "pro_growth",
      billingInterval: "month",
      amountMinorUnits: 7900,
      currency: "USD"
    }
  ]
};

const base: SubscriptionProjection = {
  status: "trialing",
  plan: "trial",
  catalogueVersion: "test",
  subscriptionRef: "sub_1",
  paidThrough: null,
  scheduledPlan: null,
  canceledAt: null,
  lastEventOccurredAt: null,
  lastEventRef: null
};

const event = (over: Partial<NormalizedBillingEvent> = {}): NormalizedBillingEvent => ({
  eventRef: "evt_1",
  eventType: "transaction.completed",
  occurredAt: "2026-08-15T12:00:00.000Z",
  subscriptionRef: "sub_1",
  customerRef: "ctm_1",
  priceIds: ["pri_starter"],
  paidThrough: "2026-09-15T12:00:00.000Z",
  status: "active",
  isPaidEvent: true,
  ...over
});

const applied = (
  projection: SubscriptionProjection,
  over: Partial<NormalizedBillingEvent> = {}
): SubscriptionProjection => {
  const outcome = applyBillingEvent(projection, event(over), catalogue);
  if (!outcome.applied) throw new Error(`expected applied, got ${outcome.reason}`);
  return outcome.projection;
};

describe("only a verified paid event raises an entitlement", () => {
  it("activates on a completed paid transaction", () => {
    const next = applied(base);
    expect(next.status).toBe("active");
    expect(next.plan).toBe("starter");
  });

  it("records the catalogue version the cycle was priced under", () => {
    expect(applied(base).catalogueVersion).toBe("test");
  });

  it("does not activate on a zero-value transaction", () => {
    // A completed transaction of zero is a trial or a full discount, not a
    // payment.
    const next = applied(base, { isPaidEvent: false });
    expect(next.status).toBe("trialing");
    expect(next.plan).toBe("trial");
  });

  it("does not raise a plan on subscription.activated", () => {
    // Activated fires for trial activation too; treating it as proof of
    // payment is the exact mistake the rule exists to prevent.
    const next = applied(base, { eventType: "subscription.activated", eventRef: "evt_act" });
    expect(next.status).toBe("trialing");
    expect(next.plan).toBe("trial");
  });

  it("does not raise a plan on subscription.updated", () => {
    // An upgrade agreed at the provider is not an upgrade paid for.
    const starter = applied(base);
    const next = applied(starter, {
      eventType: "subscription.updated",
      eventRef: "evt_up",
      priceIds: ["pri_growth"],
      occurredAt: "2026-08-16T12:00:00.000Z"
    });
    expect(next.plan).toBe("starter");
  });
});

describe("ordering guards", () => {
  it("treats a repeated event id as a no-op", () => {
    const once = applied(base);
    const twice = applyBillingEvent(once, event(), catalogue);
    expect(twice).toEqual({ applied: false, reason: "duplicate" });
  });

  it("ignores an event that happened before the projection's newest", () => {
    // Webhooks do not arrive in the order they happened.
    const current = applied(base, { occurredAt: "2026-08-20T12:00:00.000Z" });
    const late = applyBillingEvent(
      current,
      event({ eventRef: "evt_late", occurredAt: "2026-08-10T12:00:00.000Z" }),
      catalogue
    );
    expect(late).toEqual({ applied: false, reason: "out_of_order" });
  });

  it("accepts a second event sharing a timestamp", () => {
    // Dropping it would lose a real state change.
    const current = applied(base);
    const same = applyBillingEvent(
      current,
      event({ eventRef: "evt_2", occurredAt: current.lastEventOccurredAt! }),
      catalogue
    );
    expect(same.applied).toBe(true);
  });

  it("refuses an event for another subscription", () => {
    const outcome = applyBillingEvent(base, event({ subscriptionRef: "sub_other" }), catalogue);
    expect(outcome).toEqual({ applied: false, reason: "foreign_subscription" });
  });

  it("refuses an event whose price is not in the catalogue", () => {
    const outcome = applyBillingEvent(base, event({ priceIds: ["pri_unknown"] }), catalogue);
    expect(outcome).toEqual({ applied: false, reason: "unresolvable_plan" });
  });
});

describe("paid-through only moves forward", () => {
  it("extends on renewal", () => {
    const first = applied(base);
    const second = applied(first, {
      eventRef: "evt_2",
      occurredAt: "2026-09-15T12:00:00.000Z",
      paidThrough: "2026-10-15T12:00:00.000Z"
    });
    expect(second.paidThrough).toBe("2026-10-15T12:00:00.000Z");
  });

  it("never shortens access already paid for", () => {
    // A late event carrying an older period end must not claw back a month.
    const long = applied(base, { paidThrough: "2026-12-15T12:00:00.000Z" });
    const next = applied(long, {
      eventRef: "evt_2",
      occurredAt: "2026-08-15T13:00:00.000Z",
      paidThrough: "2026-09-15T12:00:00.000Z"
    });
    expect(next.paidThrough).toBe("2026-12-15T12:00:00.000Z");
  });
});

describe("downgrades wait for the renewal boundary", () => {
  const starter = applied(applied(base), {
    eventRef: "evt_dg",
    eventType: "subscription.updated",
    occurredAt: "2026-08-16T12:00:00.000Z",
    priceIds: ["pri_starter"]
  });

  it("schedules rather than applies a downgrade", () => {
    const growth: SubscriptionProjection = { ...base, plan: "growth", status: "active" };
    const next = applied(growth, {
      eventType: "subscription.updated",
      eventRef: "evt_down",
      priceIds: ["pri_starter"]
    });
    expect(next.plan).toBe("growth");
    expect(next.scheduledPlan).toBe("starter");
  });

  it("leaves the schedule alone while the period is still running", () => {
    const scheduled: SubscriptionProjection = {
      ...base,
      plan: "growth",
      status: "active",
      scheduledPlan: "starter",
      paidThrough: "2026-09-15T12:00:00.000Z"
    };
    const held = applyRenewalBoundary(scheduled, new Date("2026-08-20T12:00:00.000Z"));
    expect(held.plan).toBe("growth");
    expect(held.scheduledPlan).toBe("starter");
  });

  it("applies the downgrade once the paid period ends", () => {
    const scheduled: SubscriptionProjection = {
      ...base,
      plan: "growth",
      status: "active",
      scheduledPlan: "starter",
      paidThrough: "2026-09-15T12:00:00.000Z"
    };
    const rolled = applyRenewalBoundary(scheduled, new Date("2026-09-16T12:00:00.000Z"));
    expect(rolled.plan).toBe("starter");
    expect(rolled.scheduledPlan).toBeNull();
  });

  it("leaves an unscheduled projection untouched", () => {
    expect(applyRenewalBoundary(starter, new Date("2027-01-01T00:00:00.000Z"))).toBe(starter);
  });

  it("ranks plans for the upgrade test", () => {
    expect(isUpgrade("starter", "growth")).toBe(true);
    expect(isUpgrade("growth", "starter")).toBe(false);
    expect(isUpgrade("trial", "starter")).toBe(true);
  });
});

describe("cancel is not delete", () => {
  it("records the cancellation but keeps the paid-through date", () => {
    const active = applied(base);
    const canceled = applied(active, {
      eventRef: "evt_cancel",
      eventType: "subscription.canceled",
      occurredAt: "2026-08-20T12:00:00.000Z",
      paidThrough: null
    });
    expect(canceled.status).toBe("canceled");
    expect(canceled.canceledAt).toBe("2026-08-20T12:00:00.000Z");
    expect(canceled.paidThrough).toBe("2026-09-15T12:00:00.000Z");
  });

  it("keeps full access while the paid period runs", () => {
    expect(accessRestrictionsFor("canceled", true)).toEqual({
      dataAccess: true,
      outboundSend: true,
      export: true
    });
  });

  it("stops outbound once the paid period has passed", () => {
    expect(accessRestrictionsFor("canceled", false).outboundSend).toBe(false);
  });

  it("clears a cancellation when payment resumes", () => {
    const canceled = applied(applied(base), {
      eventRef: "evt_cancel",
      eventType: "subscription.canceled",
      occurredAt: "2026-08-20T12:00:00.000Z"
    });
    const resumed = applied(canceled, {
      eventRef: "evt_pay",
      occurredAt: "2026-08-21T12:00:00.000Z",
      paidThrough: "2026-10-15T12:00:00.000Z"
    });
    expect(resumed.canceledAt).toBeNull();
    expect(resumed.status).toBe("active");
  });
});

describe("past due restricts outbound before data", () => {
  it("goes past due on a failed payment", () => {
    const active = applied(base);
    const failed = applied(active, {
      eventRef: "evt_fail",
      eventType: "transaction.payment_failed",
      occurredAt: "2026-09-15T12:00:00.000Z"
    });
    expect(failed.status).toBe("past_due");
  });

  it("pauses sending but never withholds their own records", () => {
    // Withholding somebody's customer data over a failed card is punitive and
    // makes the problem harder to fix; pausing outbound stops the bill growing.
    expect(accessRestrictionsFor("past_due", false)).toEqual({
      dataAccess: true,
      outboundSend: false,
      export: true
    });
  });

  it("restores an unpaused subscription that is still paid up", () => {
    const active = applied(base);
    const failed = applied(active, {
      eventRef: "evt_fail",
      eventType: "subscription.past_due",
      occurredAt: "2026-08-16T12:00:00.000Z",
      paidThrough: null
    });
    const resumed = applied(failed, {
      eventRef: "evt_resume",
      eventType: "subscription.resumed",
      occurredAt: "2026-08-17T12:00:00.000Z",
      paidThrough: null
    });
    expect(resumed.status).toBe("active");
  });

  it("leaves export available in every state, including suspension", () => {
    // A suspension must never be a way to strand somebody's data.
    for (const status of [
      "incomplete",
      "trialing",
      "trial_expired_grace",
      "active",
      "past_due",
      "suspended",
      "canceled"
    ] as const) {
      expect(`${status}:${accessRestrictionsFor(status, false).export}`).toBe(`${status}:true`);
    }
  });
});

describe("normalising what Paddle sends", () => {
  const payload = {
    event_id: "evt_01hz",
    event_type: "transaction.completed",
    occurred_at: "2026-08-15T12:00:00.000000Z",
    data: {
      id: "txn_01",
      subscription_id: "sub_01",
      customer_id: "ctm_01",
      items: [{ price: { id: "pri_starter" } }],
      details: { totals: { grand_total: "2900" } },
      current_billing_period: { ends_at: "2026-09-15T12:00:00.000000Z" }
    }
  };

  it("lifts the fields the authority consumes", () => {
    const normalized = normalizePaddleEvent(payload);
    expect(normalized.ok && normalized.value).toMatchObject({
      eventRef: "evt_01hz",
      eventType: "transaction.completed",
      subscriptionRef: "sub_01",
      customerRef: "ctm_01",
      priceIds: ["pri_starter"],
      paidThrough: "2026-09-15T12:00:00.000Z",
      isPaidEvent: true
    });
  });

  it("takes the subscription's own id on a subscription event", () => {
    const normalized = normalizePaddleEvent({
      ...payload,
      event_type: "subscription.canceled",
      data: { ...payload.data, id: "sub_01" }
    });
    expect(normalized.ok && normalized.value.subscriptionRef).toBe("sub_01");
  });

  it("marks a zero-total transaction as unpaid", () => {
    const normalized = normalizePaddleEvent({
      ...payload,
      data: { ...payload.data, details: { totals: { grand_total: "0" } } }
    });
    expect(normalized.ok && normalized.value.isPaidEvent).toBe(false);
  });

  it("refuses a notification with no event id", () => {
    // Without one there is no idempotency key for the whole pipeline.
    expect(normalizePaddleEvent({ ...payload, event_id: "" }).ok).toBe(false);
    expect(normalizePaddleEvent({ ...payload, event_id: undefined }).ok).toBe(false);
  });

  it("refuses a notification with no usable occurred_at", () => {
    // Without one there is no way to order it against out-of-sequence events.
    expect(normalizePaddleEvent({ ...payload, occurred_at: "whenever" }).ok).toBe(false);
  });

  it("ignores an event type this system has no opinion about", () => {
    const normalized = normalizePaddleEvent({ ...payload, event_type: "report.created" });
    expect(normalized.ok).toBe(false);
  });

  it("survives a payload that is not an object at all", () => {
    expect(normalizePaddleEvent(null).ok).toBe(false);
    expect(normalizePaddleEvent("nonsense").ok).toBe(false);
    expect(normalizePaddleEvent([]).ok).toBe(false);
  });
});
