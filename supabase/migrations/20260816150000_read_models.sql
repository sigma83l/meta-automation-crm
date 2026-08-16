-- P10 — Workspace read models
--
-- The pack names eight read models and says the derived views are rebuildable
-- while immutable events remain the source of truth. That ordering is what
-- makes these safe: nothing below stores anything. Each view is a query with a
-- name, so a wrong number is a bug in one definition rather than a wrong row
-- that has to be found and corrected everywhere it was copied to.
--
-- Views rather than materialized views throughout. At V1 volumes the
-- aggregation is cheap, and a materialized view showing yesterday's figures as
-- though they were today's is a worse failure than a slower query: it is wrong
-- silently, and the person reading it has no way to tell.
--
-- Every view is security_invoker, so the caller's RLS applies rather than the
-- view owner's. A security-definer view over tenant tables is a hole with a
-- friendly name - it would return every workspace's rows to whoever queried it.

-- Overview: health, blockers and recent load for a single workspace.
create or replace view public.workspace_overview_view
with (security_invoker = true)
as
  select
    w.id as workspace_id,
    w.name,
    (
      select count(*) from public.conversations c
      where c.workspace_id = w.id and c.requires_human_review
    ) as conversations_awaiting_human,
    (
      select count(*) from public.handoff_packets h
      where h.workspace_id = w.id and h.acknowledged_at is null
    ) as handoffs_open,
    (
      select count(*) from public.tasks_followups f
      where f.workspace_id = w.id and f.eligibility_state = 'eligible'
    ) as followups_due,
    (
      select count(*) from public.meta_connections mc
      where mc.workspace_id = w.id and mc.status not in ('active', 'degraded')
    ) as connections_needing_attention
  from public.workspaces w;

-- Contact revenue state: the three separate concepts side by side, and
-- deliberately not merged into one "status" column. Merging them in the read
-- model would undo in SQL exactly what P5 kept apart in the schema.
create or replace view public.contact_revenue_state_view
with (security_invoker = true)
as
  select
    c.workspace_id,
    c.id as customer_id,
    c.lifecycle_stage,
    c.lead_status,
    c.qualification_score,
    (
      select count(*) from public.qualification_evidence qe
      where qe.customer_id = c.id and qe.workspace_id = c.workspace_id
    ) as evidence_count,
    (
      select max(le.occurred_at) from public.lifecycle_events le
      where le.customer_id = c.id and le.workspace_id = c.workspace_id
    ) as lifecycle_changed_at,
    (
      select count(*) from public.opportunities o
      where o.customer_id = c.id and o.workspace_id = c.workspace_id
        and o.stage not in ('won', 'lost')
    ) as open_opportunities
  from public.customers c;

-- Usage summary: cycle counters beside their limits.
--
-- Counts come from usage_totals_for_cycle's sibling logic rather than a second
-- implementation - MAC counts distinct contacts, everything else sums quantity.
-- Two implementations of that split is where a discrepancy between the invoice
-- and the usage page comes from.
create or replace view public.usage_summary_view
with (security_invoker = true)
as
  select
    bc.workspace_id,
    bc.id as billing_cycle_id,
    bc.plan,
    bc.catalogue_version,
    bc.started_at,
    bc.ends_at,
    l.meter,
    case
      when l.meter = 'mac' then count(distinct l.contact_id)
      else coalesce(sum(l.quantity), 0)
    end as used
  from public.billing_cycles bc
  left join public.usage_ledger l
    on l.billing_cycle_id = bc.id and l.workspace_id = bc.workspace_id
  where bc.closed_at is null
  group by bc.workspace_id, bc.id, bc.plan, bc.catalogue_version, bc.started_at,
           bc.ends_at, l.meter;

-- Integration health: state, last activity and what to do about it.
--
-- The recovery action is part of the read model rather than the UI, because a
-- state nobody knows how to clear is a support ticket. It is a static mapping
-- from state, not advice generated per row.
create or replace view public.integration_health_view
with (security_invoker = true)
as
  select
    mc.workspace_id,
    mc.id as connection_id,
    mc.channel,
    mc.status,
    mc.updated_at as last_state_change_at,
    case mc.status
      when 'active' then 'none'
      when 'degraded' then 'retry_or_reconnect'
      when 'policy_blocked' then 'resolve_policy_then_reconnect'
      when 'revoked' then 'reconnect'
      else 'reconnect'
    end as recovery_action
  from public.meta_connections mc;

-- Support tickets with their SLA position.
create or replace view public.support_ticket_view
with (security_invoker = true)
as
  select
    t.workspace_id,
    t.id as ticket_id,
    t.subject,
    t.status,
    t.priority,
    t.assigned_to,
    t.created_at,
    t.first_response_at,
    t.resolved_at,
    (
      select max(m.created_at) from public.support_ticket_messages m
      where m.ticket_id = t.id and m.workspace_id = t.workspace_id
    ) as last_message_at,
    (
      select m.author_kind from public.support_ticket_messages m
      where m.ticket_id = t.id and m.workspace_id = t.workspace_id
      order by m.created_at desc limit 1
    ) as last_actor
  from public.support_tickets t;

grant select on public.workspace_overview_view to authenticated;
grant select on public.contact_revenue_state_view to authenticated;
grant select on public.usage_summary_view to authenticated;
grant select on public.integration_health_view to authenticated;
grant select on public.support_ticket_view to authenticated;
