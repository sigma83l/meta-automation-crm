# Auth and workspace isolation migration

Migration: `20260728090000_auth_workspace_isolation.sql`

## Forward behavior

- Creates fresh workspace, profile, owner membership, settings, onboarding, and
  auth-audit tables.
- Provisions all signup-owned rows in the same transaction as `auth.users`.
- Enables and forces RLS on every exposed application table.
- Grants only the columns required by authenticated users.
- Creates a private `crm-private` Storage bucket with workspace-path policies.
- Adds trusted RPCs that derive workspace authority from `auth.uid()`.

## Rollback

This migration is additive and must be rolled back only before production data
exists. In a reviewed maintenance transaction:

1. Disable new signups.
2. Drop Storage policies and delete only the empty `crm-private` bucket.
3. Drop `on_auth_user_created`.
4. Drop the three public RPCs and private helper functions.
5. Drop application tables in reverse dependency order:
   `auth_audit_events`, `onboarding_states`, `workspace_settings`,
   `workspace_memberships`, `profiles`, `workspaces`.
6. Drop the four Prompt 1 enum types and the empty `private` schema.

Never delete a non-empty bucket or tables containing client data. After data
exists, rollback means restoring the previous application SHA and applying a
new forward migration, not destructive down-SQL.
