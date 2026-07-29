# Backup and Restore Runbook

## Hosted prerequisites

- Approved Supabase project and region.
- Plan with the agreed backup/PITR capability.
- Named owner and operator, MFA, maintenance window, recovery target and
  incident channel.
- Encrypted destination outside the application repository.

Never store a dump in Git, Downloads shared with third parties, CI artifacts, or
application logs.

## Backup verification

1. Record project reference, migration head and application SHA (names/IDs only
   in the report).
2. Trigger or verify the provider-managed backup without exposing credentials.
3. Restore to a new isolated non-production project.
4. apply no unreviewed migrations;
5. run schema diff, 109 pgTAP assertions, tenant/storage isolation, auth smoke
   and synthetic export reopen tests;
6. verify encrypted credential rows remain encrypted and live sends stay off;
7. destroy the temporary restore only after evidence is accepted and with
   explicit approval.

## Recovery objectives

Initial targets pending plan verification: RPO ≤24 hours, RTO ≤4 hours. A
verified PITR plan may tighten RPO. Do not claim either objective until the
hosted drill is recorded.

## Rollback

Application rollback deploys an earlier immutable SHA while leaving additive
migrations in place. Database rollback uses a new corrective migration after a
verified backup; applied migration files are never edited or deleted.
