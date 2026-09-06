-- ---------------------------------------------------------------------------
-- Putting back a trial that a status change interrupted
-- ---------------------------------------------------------------------------

-- Suspending a workspace is meant to be reversible - `AGENTS.md` and the
-- console's own documentation both say nothing is deleted and a restore returns
-- what a suspension withdrew. For a workspace inside its trial that was not
-- true: the console passed a null `trial_ends_at` into every status change, so
-- suspending a trialing customer erased the deadline, and restoring them landed
-- on 'active' with no trial and no way back. 'trialing' is unreachable once
-- `trial_consumed_at` is set, and `platform_extend_trial` refuses a workspace
-- that is not already trialing, so the state was terminal.
--
-- The console no longer erases the deadline. This function is the other half:
-- the way back for a trial that a status change interrupted.
--
-- It is not a way to grant one. Every anti-abuse invariant that makes 'trialing'
-- unreachable stays exactly where it is:
--
--   * `trial_consumed_at` must already be set - this resumes a consumed trial
--     and never starts a fresh one, and it is never cleared.
--   * `trial_ends_at` must still be in the future. A lapsed trial has nothing to
--     resume, and a converted subscription's deadline is by definition past, so
--     a paying customer cannot be moved back onto a trial by this route.
--   * The deadline does not move. Lengthening a trial is
--     `platform_extend_trial`, which has its own 90-day ceiling; a function that
--     could do both would let the two ceilings be composed.
--
-- So a workspace still gets one trial ever, of the length it was granted, and
-- staff can only put back the part of it a suspension took away.
create or replace function public.platform_resume_trial(
  trusted_workspace_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
  ends_at timestamptz;
  consumed_at timestamptz;
  affected_rows integer;
begin
  select status, trial_ends_at, trial_consumed_at
    into current_status, ends_at, consumed_at
  from public.workspace_subscriptions
  where workspace_id = trusted_workspace_id
  for update;

  if current_status is null then
    return false;
  end if;

  if current_status = 'trialing' then
    raise exception 'workspace is already in its trial';
  end if;

  if consumed_at is null then
    raise exception 'workspace has no trial to resume';
  end if;

  if ends_at is null or ends_at <= now() then
    raise exception 'the trial deadline has passed and cannot be resumed';
  end if;

  update public.workspace_subscriptions
  set
    status = 'trialing',
    -- Deliberately not touched: the deadline is what it was, and the
    -- consumption stamp is what stops this being a second trial.
    grace_ends_at = null,
    updated_at = now()
  where workspace_id = trusted_workspace_id;
  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

revoke all on function public.platform_resume_trial(uuid)
  from public, anon, authenticated;
grant execute on function public.platform_resume_trial(uuid) to service_role;
