# Runbook — Rollback and Promotion

**Source pages:** 35, 41, 46

## Promotion
1. Exact tested SHA only.
2. All required CI, RLS, E2E, security, visual/a11y checks pass.
3. Load/soak + restore evidence current.
4. Owner acceptance and provider gates complete.
5. Promote accepted artifact.
6. Post-deploy smoke + monitoring.

## Rollback
1. Trigger on P0 or integrity risk.
2. Restore prior accepted deployment artifact.
3. Do not blindly roll back irreversible DB migrations; follow documented migration restore path.
4. Reconcile provider/billing events accumulated during incident.
5. Verify idempotency before resuming queues/sends.
