-- P6 — Usage metering ledger and billing cycles
--
-- The pack requires the ledger be server-side, append-only, and rebuildable:
-- every UI aggregate must be derivable from the rows below, so that a number
-- shown to a customer can always be explained by pointing at the events behind
-- it. Aggregates are therefore a projection, never the record.
--
-- Append-only is enforced rather than documented. Postgres has no "insert only"
-- table, so the grants withhold update and delete from every role that is not
-- service_role, and a trigger refuses updates and deletes outright - including
-- from service_role, since a correction belongs in a compensating row that says
-- what it corrects.

create table if not exists public.billing_cycles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  started_at timestamptz not null,
  ends_at timestamptz not null,
  -- The catalogue this cycle was priced under. A cycle repriced against a later
  -- catalogue is a cycle whose invoice can no longer be explained.
  catalogue_version text not null,
  plan text not null check (plan in ('trial', 'starter', 'growth', 'scale')),
  closed_at timestamptz,
  constraint billing_cycles_period_ordered check (ends_at > started_at)
);

-- One open cycle per workspace. Two would double-count every meter.
create unique index if not exists billing_cycles_one_open
  on public.billing_cycles (workspace_id)
  where closed_at is null;
create index if not exists billing_cycles_workspace_period
  on public.billing_cycles (workspace_id, started_at desc);

create table if not exists public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  billing_cycle_id uuid not null references public.billing_cycles(id) on delete cascade,
  meter text not null check (
    meter in ('mac', 'ai_reply', 'automation_action', 'seat', 'media_bytes')
  ),
  -- Signed. A correction is a negative row that names what it corrects, never
  -- an edit to the row that was wrong.
  quantity bigint not null,
  -- The subject a MAC is unique over. Null for meters that do not count
  -- distinct contacts.
  contact_id uuid,
  -- Idempotency. The same source event may be delivered repeatedly by Meta, by
  -- Paddle, or by our own job runner; none of them may double-count.
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  source_event_ref text,
  -- Model and token telemetry where applicable. Deliberately not part of the
  -- quota decision: internal AI calls are telemetry, not customer quota.
  model_ref text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  unique (workspace_id, meter, idempotency_key)
);

create index if not exists usage_ledger_cycle_meter
  on public.usage_ledger (workspace_id, billing_cycle_id, meter);
-- MAC is Unique(workspace, cycle, contact); this index is what makes counting
-- the distinct contacts cheap.
create index if not exists usage_ledger_mac_contacts
  on public.usage_ledger (workspace_id, billing_cycle_id, contact_id)
  where meter = 'mac';

-- Append-only, enforced.
--
-- A ledger that can be quietly edited is not a ledger, and the failure mode is
-- specific: a usage dispute becomes unanswerable because the rows no longer say
-- what they said when the invoice was raised. Corrections go in as new signed
-- rows.
create or replace function private.reject_ledger_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'usage_ledger is append-only; record a compensating entry instead';
end;
$$;

drop trigger if exists usage_ledger_append_only on public.usage_ledger;
create trigger usage_ledger_append_only
  before update or delete on public.usage_ledger
  for each row execute function private.reject_ledger_mutation();

alter table public.billing_cycles enable row level security;
alter table public.billing_cycles force row level security;
alter table public.usage_ledger enable row level security;
alter table public.usage_ledger force row level security;

revoke all on public.billing_cycles from anon, authenticated;
revoke all on public.usage_ledger from anon, authenticated;
grant all on public.billing_cycles to service_role;
-- Not `grant all`: service_role writes the ledger and reads it, and nothing
-- more. The trigger above is the backstop, but the grant is the fence.
grant select, insert on public.usage_ledger to service_role;

-- Members may read their own workspace's usage. They may never write it: the
-- pack's rule is that caps are server-side and the UI only reflects server
-- state, which is worth nothing if a member can insert their own ledger rows.
grant select on public.billing_cycles to authenticated;
grant select on public.usage_ledger to authenticated;

create policy billing_cycles_select_member on public.billing_cycles
  for select to authenticated
  using (private.is_active_member(workspace_id));

create policy usage_ledger_select_member on public.usage_ledger
  for select to authenticated
  using (private.is_active_member(workspace_id));

-- Cycle-to-date totals, computed from the ledger rather than stored.
--
-- MAC counts distinct contacts; every other meter sums its quantity. Returning
-- both from one function keeps the two counting rules in one place, which is
-- where a discrepancy between the invoice and the usage page would otherwise
-- come from.
create or replace function public.usage_totals_for_cycle(
  trusted_workspace_id uuid,
  requested_cycle_id uuid
)
returns table (meter text, total bigint)
language sql
security definer
set search_path = ''
stable
as $$
  select
    l.meter,
    case
      when l.meter = 'mac' then count(distinct l.contact_id)
      else coalesce(sum(l.quantity), 0)
    end as total
  from public.usage_ledger l
  where l.workspace_id = trusted_workspace_id
    and l.billing_cycle_id = requested_cycle_id
  group by l.meter;
$$;

revoke all on function public.usage_totals_for_cycle(uuid, uuid) from public, anon, authenticated;
grant execute on function public.usage_totals_for_cycle(uuid, uuid) to service_role;
