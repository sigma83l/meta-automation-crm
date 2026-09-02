-- Answering a suggestion, from a browser session.
--
-- `crm_next_action_projection` grants `authenticated` select and nothing else,
-- which is right: the projection is written by engines through service role,
-- and a session that could update it could also change an action's type, its
-- confidence or its source - including to 'derived', a value the table permits
-- and only TypeScript refuses. So an update grant with a policy over it would
-- move that invariant out of the application and into nothing at all.
--
-- But settling is the one thing a *person* does to this table, and until now
-- they could not. `settleProposal` issued an update through the caller's own
-- client, matched no rows because no policy permitted it, and returned
-- ACTION_PROPOSAL_NOT_FOUND. The Take this on and Not this buttons have
-- therefore never worked outside tests that used a service-role double. The
-- E2E flow for accepting a suggestion is what surfaced it.
--
-- This is the narrow opening: two columns, two outcomes, and the caller's own
-- authority checked explicitly. Everything else about the row stays unwritable
-- from a session.

create or replace function public.settle_next_action(
  p_workspace_id uuid,
  p_proposal_id uuid,
  p_outcome text
) returns public.crm_next_action_projection
language plpgsql security definer set search_path = '' as $$
declare
  settled public.crm_next_action_projection;
begin
  -- Definer rights bypass row security, so membership and role are asked here
  -- rather than assumed. `can_operate_workspace` reads the caller's own
  -- session: a viewer's job is to read the queue, not to answer it, and a
  -- non-member gets the same answer as a stranger.
  if not private.can_operate_workspace(p_workspace_id) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- 'superseded' is the engine's word for a proposal a newer one replaced. A
  -- person choosing it would be claiming something happened that did not.
  if p_outcome is null or p_outcome not in ('accepted', 'rejected') then
    raise exception 'outcome must be accepted or rejected' using errcode = '22023';
  end if;

  -- for update: two operators answering the same suggestion would otherwise
  -- both read it unsettled and both write, and the record would show whichever
  -- committed last as though the other had never decided.
  perform 1
  from public.crm_next_action_projection
  where workspace_id = p_workspace_id and id = p_proposal_id
  for update;

  update public.crm_next_action_projection
  set settled_at = now(), settled_outcome = p_outcome
  where workspace_id = p_workspace_id
    and id = p_proposal_id
    -- Settled once. Re-answering would rewrite what somebody already decided,
    -- and the second answer would be indistinguishable from the first.
    and settled_at is null
  returning * into settled;

  if settled.id is null then
    raise exception 'no open proposal' using errcode = 'P0002';
  end if;

  return settled;
end;
$$;

revoke all on function public.settle_next_action(uuid, uuid, text) from public, anon;
grant execute on function public.settle_next_action(uuid, uuid, text)
  to authenticated, service_role;
