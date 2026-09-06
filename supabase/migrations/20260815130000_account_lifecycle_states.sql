-- P2 — account lifecycle states
--
-- Adds the two states the account state machine was missing:
--
--   trial_expired_grace  the trial ended without payment. Data is preserved and
--                        the workspace has a bounded window to add a card.
--   suspended            access withdrawn by policy rather than by billing,
--                        recoverable without losing data.
--
-- These are not cosmetic. A trial that ended with no payment method previously
-- became past_due, and past_due is re-selected by the charge cron on every tick,
-- finds no card, and writes past_due again - so it looped indefinitely with no
-- access and no route out. The grace state gives that path a deadline and a
-- terminal transition.
--
-- Cancellation remains distinct from deletion: nothing here removes data.

alter table public.workspace_subscriptions
  drop constraint if exists workspace_subscriptions_status_check;

alter table public.workspace_subscriptions
  add constraint workspace_subscriptions_status_check
  check (
    status in (
      'incomplete',
      'trialing',
      'trial_expired_grace',
      'active',
      'past_due',
      'suspended',
      'canceled'
    )
  );

-- When the grace window closes. Only meaningful while status is
-- trial_expired_grace; cleared on every other transition so a stale deadline
-- cannot resurrect an expired window.
alter table public.workspace_subscriptions
  add column if not exists grace_ends_at timestamptz;

create index if not exists workspace_subscriptions_grace_due
  on public.workspace_subscriptions (grace_ends_at)
  where status = 'trial_expired_grace';

-- The signature gains a grace deadline, so the old five-argument version is
-- dropped rather than overloaded: two candidates differing only by a defaulted
-- trailing argument would make every existing call ambiguous.
drop function if exists public.transition_workspace_subscription(
  uuid, text, uuid, timestamptz, timestamptz
);

create or replace function public.transition_workspace_subscription(
  trusted_workspace_id uuid,
  trusted_new_status text,
  trusted_plan_id uuid,
  trusted_trial_ends_at timestamptz,
  trusted_current_period_ends_at timestamptz,
  trusted_grace_ends_at timestamptz default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
  current_status text;
  trial_already_consumed boolean;
begin
  if trusted_new_status not in (
    'incomplete','trialing','trial_expired_grace','active','past_due','suspended','canceled'
  ) then
    raise exception 'invalid subscription status';
  end if;

  select status, trial_consumed_at is not null
    into current_status, trial_already_consumed
  from public.workspace_subscriptions
  where workspace_id = trusted_workspace_id
  for update;

  if current_status is null then
    return false;
  end if;

  if trusted_new_status = 'trialing' then
    if trial_already_consumed then
      raise exception 'workspace has already consumed its trial';
    end if;
    if current_status not in ('incomplete','canceled') then
      raise exception 'illegal subscription transition % -> %',
        current_status, trusted_new_status;
    end if;
  elsif trusted_new_status = 'trial_expired_grace' then
    -- Only a trial can lapse into grace, and only once: re-entering grace from
    -- grace would let the window be extended indefinitely.
    if current_status <> 'trialing' then
      raise exception 'illegal subscription transition % -> %',
        current_status, trusted_new_status;
    end if;
  elsif trusted_new_status = 'past_due' then
    if current_status not in ('trialing','active','past_due') then
      raise exception 'illegal subscription transition % -> %',
        current_status, trusted_new_status;
    end if;
  elsif trusted_new_status = 'incomplete' then
    if current_status <> 'incomplete' then
      raise exception 'illegal subscription transition % -> %',
        current_status, trusted_new_status;
    end if;
  end if;
  -- 'active', 'suspended' and 'canceled' stay reachable from any live status: a
  -- customer may pay, be suspended by policy, or be cancelled at any point.

  update public.workspace_subscriptions
  set
    status = trusted_new_status,
    plan_id = coalesce(trusted_plan_id, plan_id),
    trial_ends_at = trusted_trial_ends_at,
    current_period_ends_at = trusted_current_period_ends_at,
    trial_consumed_at = case
      when trusted_new_status = 'trialing' then now()
      else trial_consumed_at
    end,
    -- The deadline exists only while the window is open.
    grace_ends_at = case
      when trusted_new_status = 'trial_expired_grace' then trusted_grace_ends_at
      else null
    end,
    canceled_at = case when trusted_new_status = 'canceled' then now() else canceled_at end,
    updated_at = now()
  where workspace_id = trusted_workspace_id;
  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

revoke all on function public.transition_workspace_subscription(
  uuid, text, uuid, timestamptz, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.transition_workspace_subscription(
  uuid, text, uuid, timestamptz, timestamptz, timestamptz
) to service_role;
