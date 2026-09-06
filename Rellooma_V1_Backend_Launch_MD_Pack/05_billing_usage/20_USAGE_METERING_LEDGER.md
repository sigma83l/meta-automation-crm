# Usage Metering and Append-Only Ledger

**Source page:** 20

## Canonical meter semantics

| Meter | Count rule |
|---|---|
| MAC | `Unique(workspace_id, billing_cycle, contact_id)` when inbound or eligible one-to-one outbound occurs |
| AI Reply | count only customer-facing generative reply successfully sent; failed/rejected send = 0 |
| Internal AI | classification/extraction/summary/router = internal telemetry, not customer quota |
| Automation Action | executed workflow node/action; technical retry not counted again |
| Seat | active member entitlement; pending-invite policy configurable |
| Media | persisted bytes after successful storage |

## Ledger properties

- Server-side.
- Append-only / append-oriented.
- Rebuildable UI aggregates.
- Event ID + idempotency key.
- Token/model/provider telemetry when applicable.
- Billing cycle stores config/pricing version for historical audit.
- Duplicate Meta/Paddle/job events never double-count usage.
