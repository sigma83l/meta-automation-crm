-- P5 — Handoff packets
--
-- When a conversation leaves the automated path it goes to a person, and that
-- person should not have to read the thread to pick it up. The packet is stored
-- rather than rendered on demand: it is a record of what was known and suggested
-- at the moment of handoff, which is what makes a later review of a bad handoff
-- possible at all.
--
-- The nine sections from the pack are separate columns, not one jsonb blob, so
-- an incomplete packet fails on insert instead of arriving half-empty in
-- someone's queue.

create table if not exists public.handoff_packets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  conversation_id uuid,
  trigger text not null check (
    trigger in (
      'customer_requested_human', 'confidence_below_threshold', 'policy_block',
      'high_value_objection', 'repeated_failure', 'owner_takeover'
    )
  ),
  summary text not null check (char_length(summary) between 1 and 500),
  intent text not null check (char_length(intent) between 1 and 120),
  mental_state text not null check (char_length(mental_state) between 1 and 200),
  -- Facts are copied in with their provenance, because the underlying fact rows
  -- can change after the handoff and the packet must stay a record of what the
  -- human was actually told.
  known_facts jsonb not null default '[]'::jsonb,
  qualification_score integer not null default 0 check (qualification_score between 0 and 100),
  score_reasons text[] not null default '{}',
  objections text[] not null default '{}',
  actions_taken text[] not null default '{}',
  suggested_next_action text not null check (char_length(suggested_next_action) between 1 and 300),
  policy_flags text[] not null default '{}',
  -- Sections with nothing to report, named. An empty column reads as "none";
  -- this column is how the human tells that apart from "we never found out".
  unknown_sections text[] not null default '{}',
  lifecycle_stage text not null,
  lead_status text not null,
  owner_id uuid references auth.users(id) on delete set null,
  sla_minutes integer not null default 60 check (sla_minutes between 0 and 1440),
  raised_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  foreign key (customer_id, workspace_id)
    references public.customers(id, workspace_id) on delete cascade
);

-- The queue view: everything raised and not yet picked up, oldest first.
create index if not exists handoff_packets_open
  on public.handoff_packets (workspace_id, raised_at)
  where acknowledged_at is null;
create index if not exists handoff_packets_workspace_customer
  on public.handoff_packets (workspace_id, customer_id);

alter table public.handoff_packets enable row level security;
alter table public.handoff_packets force row level security;
revoke all on public.handoff_packets from anon, authenticated;
grant all on public.handoff_packets to service_role;
grant select on public.handoff_packets to authenticated;

create policy handoff_packets_select_member on public.handoff_packets
  for select to authenticated
  using (private.is_active_member(workspace_id));
