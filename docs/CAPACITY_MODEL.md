# Capacity Model

Target: 10–20 simultaneously active business workspaces and up to 1,000
synthetic panel users/conversation producers in the approved hosted proof.

This is a commercial small-business workload model, not an enterprise-scale
claim.

## Workload profiles

| Profile                  | Shape                                                       | Primary assertions                                              |
| ------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------- |
| Local tenant/concurrency | 20 workspaces, 400 webhook attempts, 20 exports             | no tenant mixing, 200 deduplicated retries, bounded concurrency |
| Panel 1,000              | ramp 0→100→500→1,000 VUs; 5-minute peak                     | health/login availability, p95 <2 s, failures <1%               |
| Conversations 1,000      | arrival rate 10→250 events/s, max 1,000 VUs, 10% duplicates | p95 ACK <1 s, failures <1%, no duplicate persistence/send       |

The k6 files live in `load/k6/`. The hosted profiles require a commercially
eligible staging environment, synthetic provider account, isolated database,
monitoring, and explicit approval. They must not run on Vercel Hobby or against
production customer data.

## Concurrency controls

- Inngest webhook processing: four concurrent functions per trusted workspace.
- Outbox relay: one scheduler instance, batches of 100, provider event ID as the
  downstream idempotency key.
- Automation contract: four runs per workspace and eight per provider adapter.
- Export artifact cleanup: one worker, batches of 250.
- Shared auth limiter: atomic Postgres upsert keyed by server HMAC.

## Scaling assumptions

- Postgres connection pooling is supplied by the approved Supabase plan.
- Webhook requests perform signature validation and one atomic ingest, then ACK.
- Long work runs through Inngest; Vercel requests do not wait on conversations.
- Export limits remain 25,000 rows, 1,000 files, and 100 MiB.
- Provider and AI quotas may be lower than application capacity and remain
  external gates.

Hosted results belong in `docs/reports/LOAD_1000_REPORT.md`; until that report
contains measured staging evidence, both 1,000-user gates are `NOT_RUN`.
