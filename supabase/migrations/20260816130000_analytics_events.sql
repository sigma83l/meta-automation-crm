-- P7 — First-party analytics event ledger and AI telemetry
--
-- The pack's two-ledger model: this is the canonical operational ledger, and an
-- external analytics tool is a visualisation consumer downstream of it. The
-- asymmetry matters. Events here are immutable and every read model is derived
-- from them, so a funnel can always be recomputed; what goes to a vendor is a
-- filtered projection that can never be recalled once sent.
--
-- The PII boundary is enforced in src/modules/analytics/pii-boundary.ts as an
-- allowlist. It is not re-implemented here, because a second implementation of
-- a security boundary is a second thing to keep in step, and the one that drifts
-- is always the copy. What this schema does instead is make the unsafe thing
-- awkward to store: properties are constrained in size, and the columns that
-- would naturally hold a message body do not exist.

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: acquisition events happen before a workspace exists. Those rows
  -- carry an anonymous_id instead and are stitched to a workspace later.
  workspace_id uuid references public.workspaces(id) on delete cascade,
  event_name text not null check (char_length(event_name) between 1 and 80),
  event_group text not null check (
    event_group in (
      'acquisition', 'activation', 'outcome', 'product', 'billing', 'reliability', 'growth'
    )
  ),
  -- Opaque per-visitor id for pre-signup events. Never an email or a phone
  -- number; the boundary module refuses those shapes.
  anonymous_id text check (anonymous_id is null or char_length(anonymous_id) between 8 and 128),
  actor_id uuid references auth.users(id) on delete set null,
  -- Subject of the event where one applies. A reference, never a copy: the
  -- ledger points at the customer row rather than duplicating anything from it.
  subject_ref text check (subject_ref is null or char_length(subject_ref) <= 200),
  -- Safe dimensions and measures only. Bounded so that a message body cannot be
  -- smuggled in as a property value without the insert failing.
  properties jsonb not null default '{}'::jsonb
    check (pg_column_size(properties) <= 4096),
  -- Idempotency: a retried job or a redelivered webhook must not inflate a
  -- funnel.
  idempotency_key text check (
    idempotency_key is null or char_length(idempotency_key) between 1 and 200
  ),
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  -- An event either belongs to a workspace or to an anonymous visitor. Neither
  -- would make the row unattributable to anything at all.
  constraint analytics_events_has_subject check (workspace_id is not null or anonymous_id is not null)
);

create unique index if not exists analytics_events_idempotent
  on public.analytics_events (workspace_id, event_name, idempotency_key)
  where idempotency_key is not null;
create index if not exists analytics_events_workspace_recent
  on public.analytics_events (workspace_id, occurred_at desc);
create index if not exists analytics_events_workspace_name
  on public.analytics_events (workspace_id, event_name, occurred_at desc);
create index if not exists analytics_events_anonymous
  on public.analytics_events (anonymous_id, occurred_at desc)
  where anonymous_id is not null;

-- AI telemetry, one row per agent run.
--
-- Deliberately separate from usage_ledger. Internal AI calls are telemetry and
-- not customer quota, and keeping them in one table would make it far too easy
-- for a quota query to accidentally count a classification call - which would
-- mean a pipeline refactor changed somebody's bill.
create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid,
  provider text not null check (char_length(provider) between 1 and 40),
  model_role text not null check (
    model_role in ('deterministic', 'utility', 'primary', 'escalation', 'offline_evaluator')
  ),
  model_id text not null check (char_length(model_id) between 1 and 120),
  prompt_version text not null default 'v1',
  -- Hash of the knowledge snapshot the run was grounded in, so a bad answer can
  -- be traced to the material it was given rather than guessed at.
  snapshot_hash text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  cached_tokens integer check (cached_tokens is null or cached_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  tool_calls integer not null default 0 check (tool_calls >= 0),
  validation_result text check (
    validation_result is null or validation_result in ('passed', 'failed', 'not_run')
  ),
  retry_count integer not null default 0 check (retry_count >= 0),
  confidence numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  route_reason text check (route_reason is null or char_length(route_reason) <= 120),
  -- Points at what the run produced. Never the text itself: telemetry that
  -- carries the reply is a copy of the conversation under another name.
  outcome_ref text check (outcome_ref is null or char_length(outcome_ref) <= 200),
  occurred_at timestamptz not null default now()
);

create index if not exists agent_runs_workspace_recent
  on public.agent_runs (workspace_id, occurred_at desc);
create index if not exists agent_runs_workspace_role
  on public.agent_runs (workspace_id, model_role, occurred_at desc);

-- Both ledgers are append-only for the same reason as usage_ledger: a funnel
-- computed from mutable rows cannot be defended, and a telemetry trail that can
-- be edited is worthless in an incident review.
create or replace function private.reject_analytics_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'analytics ledgers are append-only';
end;
$$;

drop trigger if exists analytics_events_append_only on public.analytics_events;
create trigger analytics_events_append_only
  before update or delete on public.analytics_events
  for each row execute function private.reject_analytics_mutation();

drop trigger if exists agent_runs_append_only on public.agent_runs;
create trigger agent_runs_append_only
  before update or delete on public.agent_runs
  for each row execute function private.reject_analytics_mutation();

alter table public.analytics_events enable row level security;
alter table public.analytics_events force row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_runs force row level security;

revoke all on public.analytics_events from anon, authenticated;
revoke all on public.agent_runs from anon, authenticated;
grant select, insert on public.analytics_events to service_role;
grant select, insert on public.agent_runs to service_role;
grant select on public.analytics_events to authenticated;
grant select on public.agent_runs to authenticated;

-- Members read their own workspace's events. Anonymous pre-signup rows are not
-- readable by anybody through this path: they have no workspace, so the policy
-- cannot match them, which is the correct outcome - one workspace must never be
-- able to enumerate visitors who later joined another.
create policy analytics_events_select_member on public.analytics_events
  for select to authenticated
  using (workspace_id is not null and private.is_active_member(workspace_id));

create policy agent_runs_select_member on public.agent_runs
  for select to authenticated
  using (private.is_active_member(workspace_id));

-- Daily workspace aggregate, rebuildable from the ledger.
--
-- A view rather than a materialized table: at V1 volumes the aggregation is
-- cheap, and a stale materialized view showing yesterday's numbers as today's
-- is a worse failure than a slightly slower query.
create or replace view public.analytics_daily_view
with (security_invoker = true)
as
  select
    e.workspace_id,
    date_trunc('day', e.occurred_at) as day,
    e.event_group,
    e.event_name,
    count(*) as event_count
  from public.analytics_events e
  where e.workspace_id is not null
  group by e.workspace_id, date_trunc('day', e.occurred_at), e.event_group, e.event_name;

grant select on public.analytics_daily_view to authenticated;
