# Backup, Restore, Retention, and Deletion

**Source page:** 33

## Backup layers

- **Database:** provider backup + encrypted off-site logical backup according to policy.
- **Storage:** separate object backup; DB backup contains metadata only.
- **Configuration:** recovery manifest for workspace/integration/config versions; no plaintext secrets.
- **Secrets:** references + rotation/recovery procedure only.

## Restore drill

Monthly restore must verify:

- schema;
- RLS;
- tenant isolation;
- storage;
- deletion tombstones;
- sample workspace integrity.

## Explicit deletion

1. Disable integrations/tokens/automation.
2. Delete/purge applicable DB rows, storage objects, subprocessors.
3. Retain non-PII tombstone/completion state to prevent resurrection after restore.
4. Separate legal retention exceptions from operational app data.

## Critical distinction

`subscription cancellation = billing lifecycle`

`explicit deletion = data lifecycle`

UI and jobs must never conflate them.
