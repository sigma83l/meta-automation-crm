-- P6 fix — grant the V1 trial when a workspace is provisioned
--
-- The pack's V1 trial is "7 days, no card, no auto-charge"
-- (05_billing_usage/19). The implementation did not match: the only path to
-- 'trialing' was inside card registration, which needs a card fingerprint, so a
-- newly provisioned workspace sat at 'incomplete' forever. Every paid-feature
-- runtime resolves through resolveEntitledWorkspace, which admits only
-- 'trialing' or 'active' - so onboarding failed on its first save with a
-- generic "Save failed", and the cause was a billing gate nobody was looking at.
--
-- This went unnoticed because the hosted project never had the billing
-- migration applied: workspace_subscriptions did not exist there, the gate's
-- own query failed, and the failure predated the check. Applying every
-- migration to a fresh project is what made the gate real, and the gate was
-- right - the trial was genuinely missing.
--
-- Seven days is written here rather than read from BILLING_TRIAL_DAYS because a
-- trigger has no access to application environment. That is a deliberate
-- duplication of the constant in src/modules/billing/trial-lifecycle.ts, which
-- a test pins; the pack treats the duration as a product decision rather than a
-- deployment knob.

create or replace function private.initialize_workspace_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_plan_id uuid;
  trial_length interval := interval '7 days';
begin
  select id into default_plan_id
  from public.subscription_plans
  where plan_key = 'standard_monthly' and active
  limit 1;

  -- trial_consumed_at is stamped here, at the moment the trial is granted.
  -- It is never cleared, so a workspace that cancels cannot come back around
  -- for a second free window - which is the same reason the column exists.
  insert into public.workspace_subscriptions (
    workspace_id, plan_id, status, trial_ends_at, trial_consumed_at
  )
  values (
    new.id, default_plan_id, 'trialing', now() + trial_length, now()
  )
  on conflict (workspace_id) do nothing;

  return new;
end;
$$;

-- Backfill workspaces already stranded at 'incomplete'.
--
-- Narrow on purpose: only rows that never consumed a trial, so this cannot
-- hand a second trial to anyone who already had one, and cannot disturb a
-- workspace that is past_due, canceled or paying. Their trial runs from now
-- rather than from signup, because the days they spent unable to use the
-- product are not days of trial they received.
update public.workspace_subscriptions
set status = 'trialing',
    trial_ends_at = now() + interval '7 days',
    trial_consumed_at = now(),
    updated_at = now()
where status = 'incomplete'
  and trial_consumed_at is null;
