import { appError, err, ok, type Result } from "@/src/lib/result";

/**
 * Normalises a verified Paddle notification into a provider-neutral event.
 *
 * Kept separate from signature verification so that the ordering is impossible
 * to get wrong: nothing here may run on bytes that have not already been
 * verified, and nothing here re-checks, so a caller that skips verification
 * gets no protection from this file by accident.
 *
 * Only the fields the billing authority actually consumes are lifted out. The
 * rest of the payload is retained verbatim for audit but never read for a
 * decision — a projection built from fields nobody validated is a projection
 * nobody can defend.
 */

/** The subset of Paddle's catalogue this system reacts to. */
export const PADDLE_EVENT_TYPES = [
  "transaction.completed",
  "transaction.payment_failed",
  "subscription.created",
  "subscription.activated",
  "subscription.updated",
  "subscription.paused",
  "subscription.resumed",
  "subscription.canceled",
  "subscription.past_due"
] as const;

export type PaddleEventType = (typeof PADDLE_EVENT_TYPES)[number];

export type NormalizedBillingEvent = Readonly<{
  /** Paddle's `event_id`. The idempotency key for the whole pipeline. */
  eventRef: string;
  eventType: PaddleEventType;
  /** Paddle's `occurred_at`, which orders events; delivery order does not. */
  occurredAt: string;
  subscriptionRef: string | null;
  customerRef: string | null;
  priceIds: readonly string[];
  /** Access is retained through this instant even after a cancellation. */
  paidThrough: string | null;
  status: string | null;
  /** Whether this event is evidence that money actually changed hands. */
  isPaidEvent: boolean;
}>;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Normalises a provider timestamp to a single ISO form.
 *
 * Paddle sends microsecond precision, which JavaScript cannot represent. Every
 * timestamp leaving this module goes through here so that no record ever
 * carries two different spellings of the same instant — the sort of difference
 * that compares equal by `Date.parse` and unequal by `===`, and so shows up
 * much later as a projection that will not settle.
 */
function asInstant(value: string | null): string | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function isKnownEventType(value: string): value is PaddleEventType {
  return (PADDLE_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Price ids attached to a subscription or transaction.
 *
 * Paddle nests these under `items[].price.id`; a transaction and a subscription
 * shape them the same way, so one reader covers both.
 */
function extractPriceIds(data: Record<string, unknown>): readonly string[] {
  const items = Array.isArray(data.items) ? data.items : [];
  const ids: string[] = [];
  for (const item of items) {
    const price = asRecord(asRecord(item).price);
    const id = asString(price.id);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Paid events are the only ones that may raise an entitlement.
 *
 * `subscription.activated` is deliberately excluded: it fires for a trial
 * activation too, and treating it as proof of payment is exactly the mistake
 * the pack's "upgrade only after verified paid event" rule exists to prevent.
 */
function isPaidEvent(eventType: PaddleEventType, data: Record<string, unknown>): boolean {
  if (eventType !== "transaction.completed") return false;
  // A completed transaction of zero value is a trial or a full discount, not a
  // payment.
  const details = asRecord(data.details);
  const totals = asRecord(details.totals);
  const grandTotal = asString(totals.grand_total) ?? asString(totals.total);
  if (grandTotal === null) return true;
  return Number(grandTotal) > 0;
}

/**
 * Reads a verified notification body.
 *
 * Returns a validation error rather than throwing, and refuses anything without
 * an event id or an `occurred_at`: without the first there is no idempotency
 * key, and without the second there is no way to order it against events that
 * arrive out of sequence. Both are the load-bearing fields.
 */
export function normalizePaddleEvent(payload: unknown): Result<NormalizedBillingEvent> {
  const root = asRecord(payload);

  const eventRef = asString(root.event_id);
  if (!eventRef) {
    return err(appError("VALIDATION_ERROR", "Notification has no event id."));
  }

  const rawType = asString(root.event_type);
  if (!rawType) {
    return err(appError("VALIDATION_ERROR", "Notification has no event type."));
  }
  if (!isKnownEventType(rawType)) {
    // Paddle sends event types this system has no opinion about. Ignoring one
    // is correct; guessing at it is not.
    return err(
      appError("VALIDATION_ERROR", "Notification type is not handled.", {
        details: { eventType: rawType }
      })
    );
  }

  const occurredAt = asString(root.occurred_at);
  if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) {
    return err(appError("VALIDATION_ERROR", "Notification has no usable occurred_at."));
  }

  const data = asRecord(root.data);
  const isSubscriptionEvent = rawType.startsWith("subscription.");

  return ok({
    eventRef,
    eventType: rawType,
    occurredAt: new Date(occurredAt).toISOString(),
    // On a subscription event the object's own id is the subscription; on a
    // transaction it is carried as a reference.
    subscriptionRef: isSubscriptionEvent ? asString(data.id) : asString(data.subscription_id),
    customerRef: asString(data.customer_id),
    priceIds: extractPriceIds(data),
    paidThrough: asInstant(
      asString(asRecord(data.current_billing_period).ends_at) ?? asString(data.next_billed_at)
    ),
    status: asString(data.status),
    isPaidEvent: isPaidEvent(rawType, data)
  });
}
