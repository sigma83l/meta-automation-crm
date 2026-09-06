# Runbook — Billing Reconciliation

**Source pages:** 19, 30, 41

## Trigger
Billing webhook failure, entitlement mismatch, subscription projection drift, or scheduled reconciliation.

## Procedure
1. Pause risky entitlement changes if integrity is uncertain.
2. Inspect durable `billing_events` and provider event IDs.
3. Verify signatures already passed before processing.
4. Compare local subscription projection to Paddle authoritative object/event state.
5. Use event occurrence time and state transitions; do not trust webhook arrival order.
6. Rebuild entitlement projection idempotently.
7. Recompute usage thresholds only from append-only ledger.
8. Verify paid-through/cancel/past-due behavior.
9. Record audit event and close incident only after UI matches provider truth.

## Never
Never grant access from checkout success page or browser state.
