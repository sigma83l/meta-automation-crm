-- A score that can be argued with.
--
-- `qualification_evidence` has held weights since the revenue-state migration
-- and there has never been anywhere to put the result, so every score the
-- product has ever shown would have been computed on the fly and forgotten. The
-- two questions anybody asks a score - why is it this number, and why did it
-- change - are both unanswerable without a stored snapshot.
--
-- Two tables, both append-only, and that is the whole design. A config version
-- that could be edited would make every snapshot citing it a lie, because the
-- weights it names would no longer be the weights it used. A snapshot that
-- could be edited would make the history it forms worthless. Neither is
-- corrected in place; both are corrected by adding a row.

-- Evidence needs to say which part of the score it is about. The signal column
-- is the workspace's own vocabulary and cannot carry that: two workspaces may
-- call the same observation different things, and the eight components are
-- fixed by the contract.
--
-- Nullable, and the reader drops the nulls, for the same reason `evidence_ref`
-- is nullable and dropped: rows predating the rule exist, and a row that cannot
-- say which component it belongs to must contribute nothing rather than be
-- guessed into one.
alter table public.qualification_evidence
  add column if not exists component text,
  add column if not exists expires_at timestamptz;

alter table public.qualification_evidence
  drop constraint if exists qualification_evidence_component_check;
alter table public.qualification_evidence
  add constraint qualification_evidence_component_check check (
    component is null
    or component in (
      'intent', 'fit', 'need_pain', 'urgency', 'financial_fit',
      'commitment', 'engagement', 'data_confidence', 'disqualifier'
    )
  );

-- The scorer reads one contact's current evidence and nothing else.
create index if not exists qualification_evidence_workspace_customer
  on public.qualification_evidence (workspace_id, customer_id, recorded_at desc);

create table if not exists public.crm_score_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  version text not null check (char_length(btrim(version)) between 1 and 60),
  -- The eight caps. Validated in the application, which owns the vocabulary;
  -- what SQL holds is that the object is an object and the version is unique.
  components jsonb not null check (jsonb_typeof(components) = 'object'),
  disqualifier_min integer not null default -100
    check (disqualifier_min between -100 and 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  -- One version, one meaning, forever. This is what a snapshot's
  -- config_version is worth.
  unique (workspace_id, version),
  unique (id, workspace_id)
);

create table if not exists public.crm_score_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  score integer not null check (score between 0 and 100),
  components jsonb not null check (jsonb_typeof(components) = 'object'),
  disqualifier_penalty integer not null default 0
    check (disqualifier_penalty between -100 and 0),
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  top_drivers jsonb not null default '[]'::jsonb,
  top_blockers jsonb not null default '[]'::jsonb,
  config_version text not null,
  evidence_refs text[] not null default '{}',
  reason_codes text[] not null default '{}',
  -- Null on a contact's first snapshot, and only then. "Why did this change"
  -- is answerable from the row itself rather than by recomputing history.
  previous_score integer check (previous_score is null or previous_score between 0 and 100),
  -- A human override is the one way a score is not what the evidence says, so
  -- it carries who and why or it is not an override.
  override_by uuid references auth.users(id) on delete set null,
  override_reason text check (
    override_reason is null or char_length(btrim(override_reason)) between 1 and 500
  ),
  calculated_at timestamptz not null default now(),
  foreign key (customer_id, workspace_id)
    references public.customers(id, workspace_id) on delete cascade,
  constraint crm_score_snapshots_override_check check (
    (override_by is null) = (override_reason is null)
  )
);

-- The read every score UI performs: this contact's current score, and the one
-- before it.
create index if not exists crm_score_snapshots_workspace_customer_recent
  on public.crm_score_snapshots (workspace_id, customer_id, calculated_at desc);

-- Append-only, both of them.
--
-- A snapshot is a claim about what the evidence said at an instant. Editing one
-- does not correct the past, it destroys it, and the history is the product
-- here - a score with no trail is the number nobody trusts that this table
-- exists to replace. Corrections are new snapshots; a config change is a new
-- version.
create or replace function private.reject_score_history_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception '% is append-only; record a new row instead', tg_table_name;
end;
$$;

revoke all on function private.reject_score_history_mutation() from public, anon, authenticated;

drop trigger if exists crm_score_configs_append_only on public.crm_score_configs;
create trigger crm_score_configs_append_only
  before update or delete on public.crm_score_configs
  for each row execute function private.reject_score_history_mutation();

drop trigger if exists crm_score_snapshots_append_only on public.crm_score_snapshots;
create trigger crm_score_snapshots_append_only
  before update or delete on public.crm_score_snapshots
  for each row execute function private.reject_score_history_mutation();

-- Writing a snapshot and finding the one it follows, as one statement.
--
-- previous_score cannot be read and then written by the caller: two
-- recalculations racing on one contact would both read the same previous score
-- and write two snapshots claiming to follow the same row, which is precisely
-- the history this table exists to keep straight. The customer row is locked
-- for the same reason `record_lifecycle_transition` locks it.
create or replace function public.record_score_snapshot(
  p_workspace_id uuid,
  p_customer_id uuid,
  p_score integer,
  p_components jsonb,
  p_disqualifier_penalty integer,
  p_confidence numeric,
  p_top_drivers jsonb,
  p_top_blockers jsonb,
  p_config_version text,
  p_evidence_refs text[],
  p_reason_codes text[],
  p_override_by uuid default null,
  p_override_reason text default null
) returns table(snapshot_id uuid, previous_score integer)
language plpgsql security definer set search_path = '' as $$
declare
  prior integer;
  inserted uuid;
begin
  perform 1 from public.customers
  where workspace_id = p_workspace_id and id = p_customer_id
  for update;

  if not found then
    raise exception 'customer % is not in workspace %', p_customer_id, p_workspace_id;
  end if;

  select s.score into prior
  from public.crm_score_snapshots s
  where s.workspace_id = p_workspace_id and s.customer_id = p_customer_id
  order by s.calculated_at desc, s.id desc
  limit 1;

  insert into public.crm_score_snapshots (
    workspace_id, customer_id, score, components, disqualifier_penalty, confidence,
    top_drivers, top_blockers, config_version, evidence_refs, reason_codes,
    previous_score, override_by, override_reason
  ) values (
    p_workspace_id, p_customer_id, p_score, p_components, p_disqualifier_penalty, p_confidence,
    coalesce(p_top_drivers, '[]'::jsonb), coalesce(p_top_blockers, '[]'::jsonb),
    p_config_version, coalesce(p_evidence_refs, '{}'), coalesce(p_reason_codes, '{}'),
    prior, p_override_by, p_override_reason
  ) returning id into inserted;

  return query select inserted, prior;
end; $$;

revoke all on function public.record_score_snapshot(
  uuid, uuid, integer, jsonb, integer, numeric, jsonb, jsonb, text, text[], text[], uuid, text
) from public, anon, authenticated;
grant execute on function public.record_score_snapshot(
  uuid, uuid, integer, jsonb, integer, numeric, jsonb, jsonb, text, text[], text[], uuid, text
) to service_role;

do $$ declare t text; begin
  foreach t in array array['crm_score_configs', 'crm_score_snapshots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.is_active_member(workspace_id))',
      t || '_select_member', t
    );
  end loop;
end $$;
