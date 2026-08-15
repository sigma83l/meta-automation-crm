# Paddle Billing Authority and Reconciliation

**Source pages:** 19–20

## Canonical path

`Checkout → Paddle → Verified Webhook → Durable Billing Event → Reconciliation → Entitlement`

## Never authority

- checkout success page;
- client redirect;
- browser local state.

Access changes only from verified provider events plus server reconciliation.

## Paddle requirements

- Verify raw request body with `Paddle-Signature` + endpoint secret before transform/parse.
- Insert unique durable billing event (`event_id`, `occurred_at`, hash, process state), ACK, then process async.
- Duplicate event is harmless.
- Handle out-of-order events using `occurred_at`, authoritative object state, and reconciliation.
- Product/price mappings come from versioned config, never scattered constants.
- Upgrade entitlement only after verified paid event.
- Downgrade normally at renewal boundary; preserve paid-through access.
- Cancel ≠ Delete; access continues through paid-through date.
- Past-due behavior is configurable; restrict outbound before data access.
- Scheduled reconciliation compares local projection to Paddle authoritative objects/events.
