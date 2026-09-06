# Durable Jobs, Concurrency, Retry, and Idempotency

**Source page:** 30

| Function | Concurrency key | Retry/fallback |
|---|---|---|
| Meta inbound | workspace + conversation | idempotent, preserve order, alert after exhaustion |
| AI reply | workspace | bounded retry, approved fallback, single-send guard |
| Tool action | workspace + resource | business action idempotency key |
| Follow-up | workspace | re-check eligibility at execution; honor cancel condition |
| Billing projector | subscription/customer | idempotent, occurred_at ordering, reconciliation |
| Email send | workspace + purpose | transient retry; suppression/consent before marketing |
| Deletion | workspace | stepwise durable, tombstone, retry subprocessors |
| Backup check | environment | alert on missing backup/failed restore drill |

## Flow controls

- per-tenant concurrency;
- provider-global concurrency;
- throttling;
- abuse rate limiting;
- debounce when appropriate;
- application-level idempotency even when queue vendor also supports it.
