-- Open a billing cycle on demand, and roll it over when it ends.
--
-- The ledger has required a `billing_cycle_id` since it was created and nothing
-- has ever created a cycle, so no usage could be recorded at all. This is the
-- missing half.
--
-- ## Why in SQL rather than in the application
--
-- `billing_cycles_one_open` is a unique partial index: one open cycle per
-- workspace, because two would double-count every meter. Two concurrent turns
-- for the same workspace will race for it, and a read-then-insert in TypeScript
-- loses that race by construction. Here the insert either wins or conflicts,
-- and the loser re-reads the winner's row.
--
-- ## What it does not do
--
-- It does not close a cycle for billing. Closing here only happens because the
-- window has elapsed and a new one has to start; raising an invoice, pricing it
-- and reconciling it against the provider are separate and do not exist yet.

begin;

create or replace function public.ensure_open_billing_cycle(trusted_workspace_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_id uuid;
  existing_ends timestamptz;
  plan_tier text;
  catalogue text;
  period_end timestamptz;
  opened_id uuid;
begin
  select id, ends_at into existing_id, existing_ends
  from public.billing_cycles
  where workspace_id = trusted_workspace_id and closed_at is null
  limit 1;

  if existing_id is not null and existing_ends > now() then
    return existing_id;
  end if;

  -- Elapsed, so it is closed to make room. A cycle is never reopened: its rows
  -- are what an invoice for that window was explained by.
  if existing_id is not null then
    update public.billing_cycles set closed_at = now() where id = existing_id;
  end if;

  select
    -- A plan from before tiers existed is recorded under the retired
    -- vocabulary's name for the single paid plan, rather than being given a
    -- 2026-09-v2 tier it was never sold as.
    coalesce(p.tier, case when s.plan_id is null then 'free' else 'starter' end),
    coalesce(p.plan_version, 'v1'),
    s.current_period_ends_at
  into plan_tier, catalogue, period_end
  from public.workspace_subscriptions s
  left join public.subscription_plans p on p.id = s.plan_id
  where s.workspace_id = trusted_workspace_id;

  -- No subscription row at all. Every workspace gets one on creation, so this
  -- is a workspace in a state that should not exist; it still gets a cycle,
  -- because losing the usage is worse than recording it against a default.
  if plan_tier is null then
    plan_tier := 'free';
    catalogue := 'v1';
  end if;

  -- Aligned to the paid period where there is one, so usage and the invoice
  -- describe the same window. A trial or a free plan has none, and a period
  -- already in the past cannot bound a cycle starting now.
  if period_end is null or period_end <= now() then
    period_end := now() + interval '1 month';
  end if;

  insert into public.billing_cycles
    (workspace_id, started_at, ends_at, catalogue_version, plan)
  values
    (trusted_workspace_id, now(), period_end, catalogue, plan_tier)
  on conflict do nothing
  returning id into opened_id;

  if opened_id is not null then
    return opened_id;
  end if;

  -- Lost the race. The winner's cycle is the one open cycle by definition.
  select id into opened_id
  from public.billing_cycles
  where workspace_id = trusted_workspace_id and closed_at is null
  limit 1;

  return opened_id;
end;
$$;

revoke all on function public.ensure_open_billing_cycle(uuid) from public, anon, authenticated;
grant execute on function public.ensure_open_billing_cycle(uuid) to service_role;

commit;
