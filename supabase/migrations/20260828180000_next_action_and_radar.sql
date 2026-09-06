-- What to do next, and one query that can build the list.
--
-- Two separate problems, and the split between them is the interesting part.
--
-- A next action derived from current state is not stored. It is a function of
-- what is true right now and goes stale the moment anything moves, exactly like
-- attention priority, so storing it would be a cache with no invalidation.
--
-- A next action *proposed* by somebody is a different kind of thing. It was
-- made at a time, by a model or a person, and it has to survive until it is
-- accepted, executed or superseded. That needs a row. The table below holds
-- only those - proposals - and never the derived ones.
--
-- The CRM proposes and never executes. That is the contract's hard rule, and it
-- is inherited here rather than rebuilt: `authorizeOutboundSend` and the outbox
-- already own sending, and nothing in this migration can perform an action.
-- What a row records is a suggestion and its eligibility, not a queued send.

create table if not exists public.crm_next_action_projection (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  action_type text not null check (
    action_type in (
      'reply', 'clarify', 'qualify', 'task', 'follow_up',
      'assign', 'handoff', 'booking', 'wait', 'close'
    )
  ),
  reason_codes text[] not null default '{}',
  evidence_refs text[] not null default '{}',
  owner_type text not null check (owner_type in ('human', 'ai', 'automation', 'system')),
  owner_id uuid references auth.users(id) on delete set null,
  due_at timestamptz,
  eligibility text not null default 'eligible'
    check (eligibility in ('eligible', 'blocked', 'needs_review', 'scheduled')),
  confidence numeric(3, 2) not null default 1 check (confidence between 0 and 1),
  -- 'derived' is permitted and nothing writes it. Naming the value says the
  -- distinction is intended, rather than leaving a future writer to wonder why
  -- only two of three sources ever appear.
  source text not null check (source in ('derived', 'ai', 'human')),
  -- A proposal a person has acted on stops being a proposal. Settled rows are
  -- kept because "the model suggested this and somebody rejected it" is the
  -- record that makes a bad suggestion pattern visible.
  settled_at timestamptz,
  settled_outcome text check (
    settled_outcome is null or settled_outcome in ('accepted', 'rejected', 'superseded')
  ),
  proposed_at timestamptz not null default now(),
  foreign key (customer_id, workspace_id)
    references public.customers(id, workspace_id) on delete cascade,
  -- Settled means both, or neither. A timestamp with no outcome says something
  -- happened and refuses to say what.
  constraint crm_next_action_settled_check check (
    (settled_at is null) = (settled_outcome is null)
  ),
  -- Only a human owner names a person, and a human owner must. Same rule as
  -- tasks_followups, for the same reason: an automation recorded as a person is
  -- how an operator's queue fills with work nobody assigned themselves.
  constraint crm_next_action_owner_check check (
    (owner_type = 'human') = (owner_id is not null)
  )
);

-- The read every record screen performs: this contact's live proposals.
create index if not exists crm_next_action_workspace_customer_live
  on public.crm_next_action_projection (workspace_id, customer_id, proposed_at desc)
  where settled_at is null;

alter table public.crm_next_action_projection enable row level security;
alter table public.crm_next_action_projection force row level security;
revoke all on public.crm_next_action_projection from anon, authenticated;
grant all on public.crm_next_action_projection to service_role;
grant select on public.crm_next_action_projection to authenticated;
create policy crm_next_action_select_member on public.crm_next_action_projection
  for select to authenticated using (private.is_active_member(workspace_id));

-- The index list, as one query.
--
-- The read model contract's rule is that the list must not assemble rows
-- through N+1 joins, and the current `list()` avoids that only by returning six
-- columns that say nothing. Everything the radar needs is here in one round
-- trip.
--
-- What this view deliberately does not contain is the priority or the next
-- action. Both are decided by rules that live in TypeScript and are tested
-- there, and re-encoding them in SQL would create a second implementation to
-- keep in step - the drift `record_lifecycle_transition` avoids by leaving the
-- transition rules where they already are. So the view supplies the *inputs*
-- those rules read, one row per customer, and the ranking happens once, in the
-- module that owns it.
--
-- security_invoker, like every other view here: the caller's RLS applies rather
-- than the view owner's, and a security-definer view over tenant tables would
-- return every workspace's rows to whoever asked.
create or replace view public.crm_radar_view
with (security_invoker = true)
as
  select
    c.workspace_id,
    c.id as customer_id,
    c.display_name,
    c.company_name,
    c.status,
    c.source,
    c.lifecycle_stage,
    c.lead_status,
    c.created_at,
    -- The pagination key. Deliberately the customer's own column rather than
    -- the computed last activity below: a cursor has to be indexable, and
    -- nothing can index a greatest() over three subqueries.
    c.updated_at,
    (
      select s.score from public.crm_score_snapshots s
      where s.workspace_id = c.workspace_id and s.customer_id = c.id
      order by s.calculated_at desc, s.id desc limit 1
    ) as score,
    (
      select coalesce(sum(cv.unread_count), 0) from public.conversations cv
      where cv.workspace_id = c.workspace_id and cv.customer_id = c.id
        and cv.state = 'open'
    ) as unread_inbound,
    (
      select exists(
        select 1 from public.conversations cv
        where cv.workspace_id = c.workspace_id and cv.customer_id = c.id
          and cv.state = 'open' and cv.requires_human_review
      )
    ) as human_review_requested,
    (
      select min(f.due_at) from public.tasks_followups f
      where f.workspace_id = c.workspace_id and f.customer_id = c.id
        and f.eligibility_state = 'eligible'
    ) as followup_due_at,
    (
      select max(f.next_eligible_at) from public.tasks_followups f
      where f.workspace_id = c.workspace_id and f.customer_id = c.id
        and f.eligibility_state = 'eligible'
    ) as followup_snoozed_until,
    (
      select exists(
        select 1 from public.customer_consents k
        where k.workspace_id = c.workspace_id and k.customer_id = c.id and k.opt_out
      )
    ) as opted_out,
    (
      select exists(
        select 1 from public.qualification_evidence qe
        where qe.workspace_id = c.workspace_id and qe.customer_id = c.id
          and qe.evidence_ref is not null and qe.component is not null
      )
    ) as has_evidence,
    -- Owner: the deal's, then whoever is carrying a follow-up. There is no
    -- owner column on customers, and inventing one here would be the premature
    -- denormalisation the contract warns against.
    coalesce(
      (
        select o.owner_id from public.opportunities o
        where o.workspace_id = c.workspace_id and o.customer_id = c.id
          and o.stage not in ('won', 'lost') and o.owner_id is not null
        order by o.created_at desc limit 1
      ),
      (
        select f.owner_id from public.tasks_followups f
        where f.workspace_id = c.workspace_id and f.customer_id = c.id
          and f.owner_type = 'human' and f.owner_id is not null
        order by f.due_at asc limit 1
      )
    ) as owner_id,
    (
      select cv.channel from public.conversations cv
      where cv.workspace_id = c.workspace_id and cv.customer_id = c.id
      order by cv.last_message_at desc nulls last limit 1
    ) as channel,
    -- Last activity is the latest of anything that counts as the relationship
    -- moving. The customer row's own updated_at is included because an edit is
    -- activity too.
    greatest(
      c.updated_at,
      coalesce(
        (
          select max(cv.last_message_at) from public.conversations cv
          where cv.workspace_id = c.workspace_id and cv.customer_id = c.id
        ),
        c.created_at
      ),
      coalesce(
        (
          select max(a.occurred_at) from public.customer_activities a
          where a.workspace_id = c.workspace_id and a.customer_id = c.id
        ),
        c.created_at
      )
    ) as last_activity_at
  from public.customers c;

grant select on public.crm_radar_view to authenticated;

-- Keyset pagination reads this. The existing customers indexes lead with
-- status or lifecycle and cannot serve an ordered page.
create index if not exists customers_workspace_updated_cursor
  on public.customers (workspace_id, updated_at desc, id desc);

-- Nothing else is added. The contract asks for indexes on the columns the list
-- filters by, and they exist already: lifecycle and lead status from the
-- revenue-state migration, and the last-activity subquery is served by
-- `activities_customer_time_idx`, which is this exact key. A second index on
-- the same columns costs every write and answers nothing new.
