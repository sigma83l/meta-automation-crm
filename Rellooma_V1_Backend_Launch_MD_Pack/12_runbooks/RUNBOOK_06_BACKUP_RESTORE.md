# Runbook — Backup and Restore

**Source pages:** 33, 36, 41

1. Confirm DB backup and separate Storage backup exist.
2. Restore into isolated environment.
3. Validate schema/migrations.
4. Validate RLS + cross-tenant denial.
5. Validate Storage paths and object integrity.
6. Validate deletion tombstones prevent resurrection.
7. Validate sample workspace integrity and read models.
8. Record duration, evidence, failures, follow-up actions.

Never restore secrets from plaintext backup artifacts.
