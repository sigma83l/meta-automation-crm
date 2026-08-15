-- P5 — CRM revenue state
--
-- The pack's central instruction here is to keep three concepts apart:
--
--   lifecycle_stage       how far the relationship has progressed
--   lead_status           what the conversation is waiting on right now
--   qualification_score   evidence-based fit and readiness
--
-- Collapsing them is the usual CRM mistake. A contact can be Qualified and
-- simultaneously Awaiting Customer; a Customer can be in Follow-up. Storing one
-- field and deriving the others loses exactly the distinction that makes the
-- pipeline legible, so they are three columns with three separate vocabularies.
--
-- Check constraints rather than enum types, deliberately. An enum needs
-- ALTER TYPE to extend and cannot drop a value at all - this repository already
-- carries a membership_role enum created with one value and widened later.
-- Vocabularies that will grow belong in constraints that a migration can simply
-- replace.

alter table public.customers
  add column if not exists lifecycle_stage text not null default 'new',
  add column if not exists lead_status text not null default 'awaiting_customer',
  -- 0-100. Meaningless without the evidence rows that justify it, which is why
  -- qualification_evidence exists rather than a bare number.
  add column if not exists qualification_score integer not null default 0;

alter table public.customers
  drop constraint if exists customers_lifecycle_stage_check;
alter table public.customers
  add constraint customers_lifecycle_stage_check check (
    lifecycle_stage in (
      'new', 'engaged', 'qualified', 'sales_ready', 'opportunity', 'customer', 'retention'
    )
  );

alter table public.customers
  drop constraint if exists customers_lead_status_check;
alter table public.customers
  add constraint customers_lead_status_check check (
    lead_status in ('awaiting_customer', 'follow_up', 'booked', 'payment_pending', 'lost')
  );

alter table public.customers
  drop constraint if exists customers_qualification_score_check;
alter table public.customers
  add constraint customers_qualification_score_check check (
    qualification_score between 0 and 100
  );

create index if not exists customers_workspace_lifecycle
  on public.customers (workspace_id, lifecycle_stage);
create index if not exists customers_workspace_lead_status
  on public.customers (workspace_id, lead_status);

-- Every stage change, with why. A stage that moved for no recorded reason
-- cannot be explained to the owner or corrected later.
create table if not exists public.lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  from_stage text,
  to_stage text not null,
  reason_codes text[] not null default '{}',
  evidence_ref text,
  -- Who moved it: a user id, or a system identifier for automated transitions.
  actor text not null default 'system',
  occurred_at timestamptz not null default now(),
  foreign key (customer_id, workspace_id)
    references public.customers(id, workspace_id) on delete cascade
);
create index if not exists lifecycle_events_workspace_recent
  on public.lifecycle_events (workspace_id, occurred_at desc);

-- What the score is built from. Without these a score is an opinion.
create table if not exists public.qualification_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  signal text not null check (char_length(signal) between 1 and 80),
  weight integer not null check (weight between -100 and 100),
  evidence_ref text,
  confidence text not null default 'inferred'
    check (confidence in ('inferred', 'high_confidence', 'confirmed', 'human_verified')),
  recorded_at timestamptz not null default now(),
  foreign key (customer_id, workspace_id)
    references public.customers(id, workspace_id) on delete cascade
);
create index if not exists qualification_evidence_workspace_recent
  on public.qualification_evidence (workspace_id, recorded_at desc);

-- Durable customer facts with provenance and freshness, backing the memory
-- rules already implemented in src/modules/rcos/memory-policy.ts.
create table if not exists public.contact_facts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  fact_key text not null check (char_length(fact_key) between 1 and 80),
  fact_value text not null check (char_length(fact_value) <= 2000),
  confidence text not null default 'inferred'
    check (confidence in ('inferred', 'high_confidence', 'confirmed', 'human_verified')),
  -- Mandatory: a fact nobody can trace cannot be audited or corrected.
  source_ref text not null check (char_length(source_ref) between 1 and 200),
  valid_until timestamptz,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One row per key per customer; history lives in the audit trail.
  unique (workspace_id, customer_id, fact_key),
  foreign key (customer_id, workspace_id)
    references public.customers(id, workspace_id) on delete cascade
);
create index if not exists contact_facts_workspace_customer
  on public.contact_facts (workspace_id, customer_id);

-- Follow-ups. Timer-only sequences are prohibited by the pack, so the columns
-- that make a follow-up justifiable are all NOT NULL: without an objective and
-- a cancel condition, a scheduled message is just a timer.
create table if not exists public.tasks_followups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  stop_reason text not null check (
    stop_reason in (
      'waiting_after_answer', 'price_sent', 'appointment_proposed',
      'human_promised_response', 'abandoned_booking', 'post_service'
    )
  ),
  objective text not null check (char_length(objective) between 1 and 200),
  cancel_condition text not null check (char_length(cancel_condition) between 1 and 200),
  eligibility_state text not null default 'eligible'
    check (eligibility_state in ('eligible', 'blocked', 'cancelled', 'completed')),
  message_version text not null default 'v1',
  due_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (customer_id, workspace_id)
    references public.customers(id, workspace_id) on delete cascade
);
create index if not exists tasks_followups_due
  on public.tasks_followups (workspace_id, due_at)
  where eligibility_state = 'eligible';

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  stage text not null default 'open'
    check (stage in ('open', 'proposed', 'won', 'lost')),
  -- A band rather than an amount: a model-estimated figure would look
  -- authoritative and would not be.
  value_band text check (value_band in ('unknown', 'low', 'medium', 'high')),
  owner_id uuid references auth.users(id) on delete set null,
  lost_reason text check (lost_reason is null or char_length(lost_reason) <= 200),
  next_action text check (next_action is null or char_length(next_action) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (customer_id, workspace_id)
    references public.customers(id, workspace_id) on delete cascade
);
create index if not exists opportunities_workspace_stage
  on public.opportunities (workspace_id, stage);

do $$ declare t text; begin
  foreach t in array array[
    'lifecycle_events', 'qualification_evidence', 'contact_facts',
    'tasks_followups', 'opportunities'
  ] loop
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
