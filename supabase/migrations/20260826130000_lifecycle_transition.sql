-- Moving a customer's lifecycle stage, and saying why, as one write.
--
-- Two tables have to agree: `customers.lifecycle_stage` is where the current
-- stage is read from, and `lifecycle_events` is the record of how it got there.
-- Split across two statements they can diverge, and the two failures are not
-- equally bad. A stage that moved with no event is unrepairable - nothing left
-- can say why, and the pack's rule that every transition carries evidence,
-- reason and actor is silently broken. An event with no stage change is
-- visible: the event names from_stage, so the disagreement is detectable and
-- the stage can be rebuilt from the log.
--
-- A function makes the question moot. Both writes commit or neither does.
--
-- The transition rules themselves stay in TypeScript
-- (`authorizeLifecycleTransition`), which already implements them and is unit
-- tested. Re-encoding them here would create two vocabularies to keep in step,
-- and the second one would drift. What SQL owns is what SQL is uniquely good
-- at: atomicity, and the concurrency check below.

create or replace function public.record_lifecycle_transition(
  p_workspace_id uuid,
  p_customer_id uuid,
  p_from_stage text,
  p_to_stage text,
  p_reason_codes text[],
  p_evidence_ref text,
  p_actor text
) returns table(result text, event_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  current_stage text;
  inserted_id uuid;
begin
  -- for update: two transitions racing on one customer would otherwise both
  -- read the same from_stage, both pass their check, and both write an event -
  -- leaving two events claiming to start from the same place and a stage set by
  -- whichever committed last.
  select lifecycle_stage into current_stage
  from public.customers
  where workspace_id = p_workspace_id and id = p_customer_id
  for update;

  if current_stage is null then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  -- The caller decided this move against a stage it read earlier. If the stage
  -- has changed since, that decision was made against facts that no longer
  -- hold, and applying it anyway would overwrite whatever moved it.
  if current_stage <> p_from_stage then
    return query select 'stale'::text, null::uuid;
    return;
  end if;

  insert into public.lifecycle_events
    (workspace_id, customer_id, from_stage, to_stage, reason_codes, evidence_ref, actor)
  values
    (p_workspace_id, p_customer_id, p_from_stage, p_to_stage,
     coalesce(p_reason_codes, '{}'), p_evidence_ref, p_actor)
  returning id into inserted_id;

  update public.customers
  set lifecycle_stage = p_to_stage, updated_at = now()
  where workspace_id = p_workspace_id and id = p_customer_id;

  return query select 'recorded'::text, inserted_id;
end; $$;

revoke all on function public.record_lifecycle_transition(uuid,uuid,text,text,text[],text,text)
  from public, anon, authenticated;
grant execute on function public.record_lifecycle_transition(uuid,uuid,text,text,text[],text,text)
  to service_role;

-- Reading one customer's history, newest first. The existing index leads with
-- workspace and occurred_at, which serves a workspace-wide feed rather than the
-- per-record timeline this is actually read for.
create index if not exists lifecycle_events_workspace_customer_recent
  on public.lifecycle_events (workspace_id, customer_id, occurred_at desc);
