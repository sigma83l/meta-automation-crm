-- ---------------------------------------------------------------------------
-- Moving a workspace onto another plan, without re-asking the state machine
-- ---------------------------------------------------------------------------

-- The console's "move to plan" action expressed a plan change as a status
-- transition to the status the workspace was already in, so that
-- `transition_workspace_subscription` would carry the new `plan_id` along. That
-- works for a paying workspace and fails for every trialing one: a
-- 'trialing' -> 'trialing' transition is illegal by design, and
-- `trial_consumed_at` is already set, so the function raises 'workspace has
-- already consumed its trial' and the console reports "Plan change failed".
--
-- Since `20260818120000_no_card_trial_on_provision` every workspace begins in
-- 'trialing', so the failure covered every customer who had not yet converted -
-- exactly the ones somebody is most likely to be moving between plans.
--
-- The refusal is correct and stays; what was wrong is asking the question. A
-- plan change is not a status transition, so it gets its own narrow path in the
-- same shape as `platform_extend_trial`: one field, every invariant around it
-- left standing. Status, both trial columns and every deadline are untouched
-- here, which means this cannot grant a trial, end one, or move a workspace
-- between billing states no matter which plan is named.
create or replace function public.platform_set_workspace_plan(
  trusted_workspace_id uuid,
  trusted_plan_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
  plan_is_active boolean;
begin
  select active into plan_is_active
  from public.subscription_plans
  where id = trusted_plan_id;

  if plan_is_active is null then
    raise exception 'unknown plan';
  end if;

  -- A retired plan is still a plan a workspace may sit on - that is what
  -- grandfathering is - but moving somebody onto one is a decision the
  -- catalogue has already made against, so it is refused here rather than
  -- discovered later at renewal.
  if not plan_is_active then
    raise exception 'plan is not active and cannot be assigned';
  end if;

  update public.workspace_subscriptions
  set plan_id = trusted_plan_id,
      updated_at = now()
  where workspace_id = trusted_workspace_id;
  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

revoke all on function public.platform_set_workspace_plan(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.platform_set_workspace_plan(uuid, uuid) to service_role;
