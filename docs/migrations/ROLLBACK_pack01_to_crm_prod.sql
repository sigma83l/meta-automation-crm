-- Rollback for the Pack 01 migration set applied to `crm-prod`.
--
-- Reverses the 12 migrations from 20260826120000 through 20260902140000: the
-- CRM intelligence tables, the platform console schema, and the columns those
-- added to existing tables.
--
-- ## Why this is a safe rollback here, and would not be everywhere
--
-- It drops eleven tables and one view. That is only recoverable-by-definition
-- because at the time of the push every one of them was new and empty, and
-- every table the migrations wrote to with UPDATE (`customers`,
-- `handoff_packets`) held zero rows, verified over PostgREST before applying.
-- Production held 3 workspaces and 3 profiles, and no migration in the set
-- touches either with UPDATE or DELETE.
--
-- **If the console has been used since the push, this file is no longer a
-- rollback.** `platform_admin_audit_events` is an append-only ledger, and
-- dropping it destroys the record of every staff action taken. Read the row
-- counts before running this, and if the ledger is non-empty, export it first.
--
-- Run order matters: dependents before dependencies.

begin;

-- The console's own schema. `platform_admin_audit_events` last among these
-- would be pointless ceremony - the drop is what removes it either way - so
-- the guard above is the only thing standing between this and a lost ledger.
drop view if exists public.crm_radar_view;

drop table if exists public.workspace_feature_overrides;
drop table if exists public.plan_feature_defaults;
drop table if exists public.feature_flags;
drop table if exists public.platform_switches;
drop table if exists public.platform_impersonation_grants;
drop table if exists public.platform_admin_audit_events;
drop table if exists public.platform_admins;

-- The CRM intelligence tables.
drop table if exists public.crm_next_action_projection;
drop table if exists public.crm_saved_views;
drop table if exists public.crm_score_snapshots;
drop table if exists public.crm_score_configs;

-- The four cross-tenant SELECT policies the console added to existing tables.
-- These are the only change the migration set made to pre-existing objects
-- that alters who can read what, so they are the ones that matter most to
-- remove: leaving them behind would keep `private.is_platform_admin()` in the
-- policy set of four tenant tables after the function itself is gone.
drop policy if exists workspaces_select_platform_admin on public.workspaces;
drop policy if exists profiles_select_platform_admin on public.profiles;
drop policy if exists memberships_select_platform_admin on public.workspace_memberships;
drop policy if exists workspace_subscriptions_select_platform_admin
  on public.workspace_subscriptions;

drop function if exists public.current_platform_admin();
drop function if exists public.workspace_feature_enabled(uuid, text);
drop function if exists public.workspace_feature_flags(uuid);
drop function if exists public.platform_extend_trial(uuid, timestamptz);
drop function if exists public.settle_next_action(uuid, uuid, text);
drop function if exists private.is_platform_admin();
drop function if exists private.platform_admin_rank();
drop function if exists private.reject_audit_mutation();

-- Columns added to existing tables.
--
-- Deliberately last, and deliberately optional: all thirteen are nullable
-- additions, so leaving them in place costs nothing and breaks nothing on the
-- older application build. Drop them only if the goal is a byte-exact return
-- to the prior schema; a column dropped here takes any value written to it
-- since the push, which the tables above cannot claim to have been empty of.
-- Uncomment deliberately.
--
-- alter table public.qualification_evidence
--   drop column if exists component,
--   drop column if exists expires_at;
-- alter table public.tasks_followups
--   drop column if exists owner_type,
--   drop column if exists owner_id,
--   drop column if exists last_result,
--   drop column if exists next_eligible_at;
-- alter table public.opportunities
--   drop column if exists outcome_source,
--   drop column if exists outcome_evidence_ref,
--   drop column if exists outcome_recorded_at;
-- alter table public.custom_field_definitions
--   drop column if exists ai_write;
-- alter table public.customer_custom_field_values
--   drop column if exists written_by,
--   drop column if exists confidence,
--   drop column if exists source_ref;

-- The migration history rows, so a later `supabase db push` re-applies the set
-- rather than believing it is already there.
delete from supabase_migrations.schema_migrations
where version in (
  '20260826120000', '20260826130000', '20260826140000', '20260826150000',
  '20260828120000', '20260828140000', '20260828160000', '20260828180000',
  '20260828190000', '20260828200000', '20260902120000', '20260902140000'
);

commit;
