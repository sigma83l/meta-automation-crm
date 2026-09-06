# Runbook — Deletion Retry

**Source pages:** 33, 41

1. Verify explicit deletion request and authority.
2. Disable integrations/tokens/automation first.
3. Continue stepwise DB/storage/subprocessor purge idempotently.
4. Record each completed scope in deletion ledger.
5. Preserve non-PII tombstone/completion state.
6. Apply legal-retention exception only through explicit policy.
7. Verify restored snapshots cannot resurrect deleted tenant data.
