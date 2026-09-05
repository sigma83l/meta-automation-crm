-- Rollback for the two platform billing functions applied to `crm-prod`.
--
-- Reverses 20260905100000_platform_set_workspace_plan.sql and
-- 20260905110000_platform_resume_trial.sql, applied 2026-09-06.
--
-- ## Why this one is a genuine rollback
--
-- Both migrations are `create or replace function` on names that did not exist
-- on the project before — verified against the repository's whole migration
-- history and against the live database, where both calls returned "function
-- not found" until the push. So dropping them restores the previous state
-- exactly. Neither migration creates a table, alters a column, or writes a row,
-- and neither function is reachable except through `service_role`: both are
-- revoked from `public`, `anon` and `authenticated`, which the applied
-- functions were checked for afterwards (42501 for the anon key on both).
--
-- ## The one thing that stops being true
--
-- At the time of the push the application code that calls these was committed
-- but **not deployed**, so nothing in production could reach either function
-- and dropping them changed nothing anybody could observe. Once the console
-- ships, `setWorkspacePlan` and `resumeTrial` call them by name and dropping
-- them turns the console's "Move to plan" and "Resume trial" buttons into a
-- server error rather than a missing feature. Roll the deployment back first,
-- or not at all.
--
-- Dropping these does not restore the behaviour they replaced. `setWorkspacePlan`
-- previously routed a plan change through `transition_workspace_subscription`,
-- which raised on every trialing workspace; that route lives in the application
-- code, not here, so this file cannot and should not bring it back.

begin;

drop function if exists public.platform_resume_trial(uuid);
drop function if exists public.platform_set_workspace_plan(uuid, uuid);

-- The migration history rows, so a later `supabase db push` re-applies the pair
-- rather than believing it is already there.
delete from supabase_migrations.schema_migrations
where version in ('20260905100000', '20260905110000');

commit;
