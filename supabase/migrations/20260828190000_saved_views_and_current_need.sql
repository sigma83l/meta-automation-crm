-- The lists an operator picks between, and the one column the radar was still
-- missing.
--
-- A saved view is a query definition the server owns. The pack's rule is that
-- it is workspace scoped and never a client-supplied filter string, and the
-- shape below is how that is enforced rather than promised: every filter is its
-- own column, constrained to a vocabulary the application already fixes. There
-- is deliberately no column holding a fragment of a query. A jsonb definition
-- would have been fewer lines and would have accepted anything a caller sent,
-- with the checking left to whichever code path happened to read it.

create table if not exists public.crm_saved_views (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  status text check (status is null or status in ('active', 'archived')),
  lifecycle_stage text check (
    lifecycle_stage is null or lifecycle_stage in (
      'new', 'engaged', 'qualified', 'sales_ready', 'opportunity', 'customer', 'retention'
    )
  ),
  lead_status text check (
    lead_status is null or lead_status in (
      'needs_reply', 'awaiting_customer', 'follow_up_due', 'human_review',
      'booked', 'payment_pending', 'closed'
    )
  ),
  -- The two filters that are not column equality. They are answered against the
  -- attention verdict, which is computed where its rules live; the column only
  -- records which question this view asks.
  attention text check (attention is null or attention in ('needs_attention', 'follow_up_due')),
  active_within_days integer check (
    active_within_days is null or active_within_days between 1 and 365
  ),
  -- The view belongs to the workspace, not to whoever happened to define it, so
  -- it outlives their account rather than disappearing from everyone's index.
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A definition with nothing in it is All Customers under another name. Saying
  -- so on insert beats a workspace accumulating identical-looking views that
  -- differ only in a filter somebody forgot to set.
  constraint crm_saved_views_not_empty check (
    status is not null or lifecycle_stage is not null or lead_status is not null
    or attention is not null or active_within_days is not null
  )
);

-- Names are how an operator tells two views apart, so two that differ only in
-- capitals are a collision, not a pair.
create unique index if not exists crm_saved_views_workspace_name
  on public.crm_saved_views (workspace_id, lower(btrim(name)));

alter table public.crm_saved_views enable row level security;
alter table public.crm_saved_views force row level security;
revoke all on public.crm_saved_views from anon, authenticated;
grant all on public.crm_saved_views to service_role;
grant select, insert, update, delete on public.crm_saved_views to authenticated;

-- Every member reads them: a view nobody else can see is a bookmark. Only a
-- member who can operate the workspace defines one, because a saved view is
-- shared furniture - a viewer changing what the team's index means is a wider
-- permission than a viewer's read-only role grants anywhere else here.
create policy crm_saved_views_select_member on public.crm_saved_views
  for select to authenticated using (private.is_active_member(workspace_id));
create policy crm_saved_views_insert_operator on public.crm_saved_views
  for insert to authenticated with check (private.can_operate_workspace(workspace_id));
create policy crm_saved_views_update_operator on public.crm_saved_views
  for update to authenticated using (private.can_operate_workspace(workspace_id))
  with check (private.can_operate_workspace(workspace_id));
create policy crm_saved_views_delete_operator on public.crm_saved_views
  for delete to authenticated using (private.can_operate_workspace(workspace_id));

-- Current need, which the radar lists as a primary column and the record's Now
-- card asks for first.
--
-- It comes from customer memory under a reserved key rather than from anything
-- derived, because it is a claim about what somebody wants and the only honest
-- source for that is what they said. `contact_facts` already carries the
-- provenance and confidence that makes such a claim reviewable, and holds one
-- row per key per customer, so the reserved key is a lookup rather than a
-- ranking.
--
-- The confidence travels with it. A need inferred by a model and a need the
-- customer stated are not the same thing, and a column showing only the text
-- would present them as if they were. Nothing writes this key yet - the AI
-- write engine does, later in the pack - so today it reads as unknown, which is
-- the pack's rule for an unknown: say so rather than leave the space blank.
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
    ) as last_activity_at,
    -- An expired fact is absent, the same rule the memory policy applies: a
    -- need that has passed its validity window is what they wanted last month.
    (
      select f.fact_value from public.contact_facts f
      where f.workspace_id = c.workspace_id and f.customer_id = c.id
        and f.fact_key = 'current_need'
        and (f.valid_until is null or f.valid_until > now())
    ) as current_need,
    (
      select f.confidence from public.contact_facts f
      where f.workspace_id = c.workspace_id and f.customer_id = c.id
        and f.fact_key = 'current_need'
        and (f.valid_until is null or f.valid_until > now())
    ) as current_need_confidence
  from public.customers c;

grant select on public.crm_radar_view to authenticated;

-- The reserved key, looked up per row. Without this the need column turns the
-- list into one seek per customer over the whole fact table.
create index if not exists contact_facts_workspace_key
  on public.contact_facts (workspace_id, fact_key, customer_id);
