# Operations Manual

## Daily

- review connection health, oldest outbox row, failed durable steps, dead
  letters, human-review queue, auth throttling and expired exports;
- confirm live-send and demo-mode gates match the approved environment;
- investigate safe error codes without opening customer content unnecessarily.

## Deployment

1. use a clean immutable SHA with a passing protected CI run;
2. verify environment names, approved owner/team/plan and migration head;
3. back up and test additive migrations in staging;
4. deploy Preview, run health/auth/two-tenant/webhook/export smoke;
5. obtain explicit production approval;
6. deploy the same artifact, observe error/latency/queue signals, and retain the
   prior deployment for rollback.

## Recovery

- Reauthorize expired Meta connections; never display or reuse plaintext tokens.
- Recover dead letters only after fixing the cause and verifying send
  idempotency.
- Mark provider-send/local-persistence uncertainty as `sent_unknown`.
- Pause the smallest affected scope first; use the global gate for systemic
  risk.

## Scheduled work

- Meta outbox relay: every minute.
- Private artifact/auth limiter cleanup: daily at 03:17 UTC.
- Hosted backup verification: according to the approved plan.
- Credential and access review: quarterly and on personnel change.

See `SLOS_AND_ALERTS.md`, `INCIDENT_RESPONSE.md`,
`BACKUP_RESTORE_RUNBOOK.md`, and `AUTOMATION_RECOVERY_RUNBOOK.md`.
