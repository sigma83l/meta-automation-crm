-- Repairs check_and_record_trial_fingerprint, which has never run successfully.
--
-- The function declares `returns table (is_new, first_seen_workspace_id,
-- first_seen_at)`, and in PL/pgSQL those OUT parameters are variables in scope
-- for the whole body. The `inserted` CTE then wrote
-- `returning fingerprint_hash, first_seen_workspace_id, first_seen_at`, where
-- the last two names mean both a column of private.trial_fraud_signals and one
-- of those variables - so Postgres refused the call with 42702, "column
-- reference is ambiguous", before touching a row.
--
-- The `bumped` CTE beside it was already written with a `signals.` qualifier,
-- which is exactly why only one of the two branches failed and why the defect
-- reads as a typo rather than a misunderstanding.
--
-- What it cost: every card registration reached this line and threw. The
-- callback caught it and redirected to /settings/billing?status=error, leaving
-- the registration session stranded in `processing` - which then made the next
-- attempt take the "no live pending session" path and report
-- pending_confirmation instead. Nobody could add a payment method. Trials still
-- worked because a workspace is granted one at provisioning
-- (20260818120000_no_card_trial_on_provision.sql) without a card, so the only
-- caller of this function was the path nobody had exercised end to end.
--
-- Fixed by qualifying the RETURNING list against the insert target, matching
-- what `bumped` already did. The signature, the semantics and the returned
-- column names are unchanged, so no caller changes.
create or replace function public.check_and_record_trial_fingerprint(
  requested_fingerprint_hash text,
  trusted_workspace_id uuid
) returns table (is_new boolean, first_seen_workspace_id uuid, first_seen_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if requested_fingerprint_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid fingerprint hash';
  end if;

  return query
  with inserted as (
    insert into private.trial_fraud_signals as signals
      (fingerprint_hash, first_seen_workspace_id, first_seen_at)
    values (requested_fingerprint_hash, trusted_workspace_id, now())
    on conflict (fingerprint_hash) do nothing
    returning signals.fingerprint_hash, signals.first_seen_workspace_id, signals.first_seen_at
  ),
  bumped as (
    update private.trial_fraud_signals signals
    set occurrence_count = signals.occurrence_count + 1
    where signals.fingerprint_hash = requested_fingerprint_hash
      and not exists (select 1 from inserted)
    returning signals.fingerprint_hash, signals.first_seen_workspace_id, signals.first_seen_at
  )
  select true, i.first_seen_workspace_id, i.first_seen_at from inserted i
  union all
  select false, b.first_seen_workspace_id, b.first_seen_at from bumped b;
end;
$$;
revoke all on function public.check_and_record_trial_fingerprint(text,uuid) from public, anon, authenticated;
grant execute on function public.check_and_record_trial_fingerprint(text,uuid) to service_role;
