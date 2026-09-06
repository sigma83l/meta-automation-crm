-- Billing: card-upfront trial gating, encrypted stored-card tokens, an
-- append-only HMAC trial-fingerprint ledger, and a swappable payment
-- provider seam (fake adapter in dev/test, PayTR in production).

create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null unique check (plan_key ~ '^[a-z0-9_]{2,40}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  price_minor_units integer not null check (price_minor_units > 0),
  currency text not null default 'TRY' check (currency ~ '^[A-Z]{3}$'),
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.workspace_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id uuid references public.subscription_plans(id) on delete restrict,
  status text not null default 'incomplete' check (status in ('incomplete','trialing','active','past_due','canceled')),
  trial_ends_at timestamptz,
  -- Set the first time this workspace ever enters 'trialing', and never
  -- cleared. Trial eligibility keyed only on the card fingerprint was not
  -- enough: a canceled workspace could restore itself to a fresh trial window
  -- simply by registering a different card, repeatedly. This is the
  -- workspace-side half of that rule and is enforced in
  -- transition_workspace_subscription, not in application code.
  trial_consumed_at timestamptz,
  current_period_ends_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id),
  unique (id, workspace_id)
);

create table public.billing_payment_methods (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('fake','paytr')),
  provider_customer_ref_ciphertext text not null,
  provider_customer_ref_iv text not null,
  provider_customer_ref_auth_tag text not null,
  provider_card_ref_ciphertext text not null,
  provider_card_ref_iv text not null,
  provider_card_ref_auth_tag text not null,
  key_version integer not null check (key_version > 0),
  masked_card_suffix text not null check (masked_card_suffix ~ '^[A-Za-z0-9_-]{4}$'),
  card_brand text,
  status text not null default 'active' check (status in ('active','replaced','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index billing_payment_methods_one_active
  on public.billing_payment_methods(workspace_id)
  where status = 'active';

-- Append-only, HMAC-only trial-abuse ledger. Never purged by TTL: a card
-- that already consumed a trial must stay "already used" indefinitely, even
-- if the originating workspace is later deleted (hence the nullable FK).
create table private.trial_fraud_signals (
  fingerprint_hash text primary key check (fingerprint_hash ~ '^[a-f0-9]{64}$'),
  first_seen_workspace_id uuid references public.workspaces(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  occurrence_count integer not null default 1 check (occurrence_count > 0)
);
revoke all on table private.trial_fraud_signals from public, anon, authenticated;
grant all on table private.trial_fraud_signals to service_role;

create table public.billing_callback_nonces (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  purpose text not null default 'card_registration' check (purpose in ('card_registration')),
  state_hash text not null check (state_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, purpose)
);

-- One row per card-registration attempt, created the moment an authorized
-- Owner/Admin starts one. The provider's merchant_oid (provider_session_ref)
-- is the only thing that later binds a signature-verified server-to-server
-- card-storage notification back to a workspace: the notification payload
-- never selects a tenant, the stored row does (same rule as
-- meta_connections/ingest_meta_event, D-017). Claimed exactly once.
create table public.billing_card_registration_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('fake','paytr')),
  provider_session_ref text not null check (provider_session_ref ~ '^[A-Za-z0-9_-]{8,128}$'),
  initiated_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','processing','completed','failed','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (provider, provider_session_ref)
);
create index billing_card_registration_sessions_workspace_pending
  on public.billing_card_registration_sessions(workspace_id)
  where status = 'pending';

create table public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- 'fake' is permitted so the local synthetic webhook path is exercisable at
  -- all; it previously violated this constraint and threw on every call, which
  -- left the entire webhook -> outbox -> consequence path untested. The safety
  -- property does not live here: app/api/webhooks/paytr/route.ts refuses a
  -- fake-provider notification unless APP_DEPLOYMENT_MODE is 'local'.
  provider text not null check (provider in ('fake','paytr')),
  provider_event_ref text not null,
  event_type text not null,
  safe_payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  processing_status text not null default 'accepted' check (processing_status in ('accepted','processed','rejected')),
  unique (provider, provider_event_ref)
);
create table public.billing_provider_event_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  webhook_event_id uuid not null unique references public.billing_webhook_events(id) on delete cascade,
  event_name text not null default 'billing/webhook.received',
  payload jsonb not null,
  emitted_at timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.billing_charge_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  subscription_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  status text not null default 'pending' check (status in ('pending','succeeded','declined','charge_unknown')),
  provider_transaction_ref text,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  foreign key (subscription_id, workspace_id)
    references public.workspace_subscriptions(id, workspace_id) on delete cascade,
  unique (subscription_id, attempt_number)
);

create table public.billing_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  status text not null default 'success',
  safe_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array[
    'workspace_subscriptions','billing_payment_methods','billing_callback_nonces',
    'billing_card_registration_sessions',
    'billing_webhook_events','billing_provider_event_outbox','billing_charge_attempts',
    'billing_audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

alter table public.subscription_plans enable row level security;
alter table public.subscription_plans force row level security;
revoke all on public.subscription_plans from anon, authenticated;
grant select on public.subscription_plans to authenticated;
grant all on public.subscription_plans to service_role;
create policy subscription_plans_select_active on public.subscription_plans
  for select to authenticated using (active);

-- Members may read subscription/payment-method status; ciphertext columns
-- are excluded from the grant entirely (Postgres privilege layer, not just
-- RLS), same as workspace_ai_credentials and meta_connections. All writes
-- go through service-role code + the RPCs below, never a direct authenticated
-- write policy, so role gating (assertWorkspaceManager) lives in application code.
grant select(workspace_id,status,plan_id,trial_ends_at,current_period_ends_at,canceled_at,created_at,updated_at)
  on public.workspace_subscriptions to authenticated;
create policy workspace_subscriptions_select_member on public.workspace_subscriptions
  for select to authenticated using (private.is_active_member(workspace_id));

grant select(workspace_id,provider,masked_card_suffix,card_brand,status,created_at,updated_at)
  on public.billing_payment_methods to authenticated;
create policy billing_payment_methods_select_member on public.billing_payment_methods
  for select to authenticated using (private.is_active_member(workspace_id));

grant select on public.billing_webhook_events, public.billing_audit_events, public.billing_charge_attempts
  to authenticated;
create policy billing_webhook_events_select_member on public.billing_webhook_events
  for select to authenticated using (private.is_active_member(workspace_id));
create policy billing_audit_events_select_member on public.billing_audit_events
  for select to authenticated using (private.is_active_member(workspace_id));
create policy billing_charge_attempts_select_member on public.billing_charge_attempts
  for select to authenticated using (private.is_active_member(workspace_id));

comment on table public.billing_callback_nonces is
  'Server-only SHA-256 hashes of short-lived billing callback state values; consumed exactly once.';
comment on table public.billing_provider_event_outbox is
  'Durable billing/webhook.received emission seam; one row per accepted payment webhook event.';
comment on table private.trial_fraud_signals is
  'HMAC-only, append-only ledger of payment-card fingerprints that already consumed a trial. Never purged by TTL.';
comment on table public.billing_payment_methods is
  'Server-managed AES-256-GCM envelopes only. Plaintext provider tokens are prohibited.';

-- Single-use, signed billing callback state consumption. Structural copy of
-- consume_meta_oauth_nonce: one guarded UPDATE makes "consumed exactly once" atomic.
create or replace function public.consume_billing_callback_nonce(
  p_workspace_id uuid,
  p_purpose text,
  p_state_hash text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
begin
  update public.billing_callback_nonces
  set consumed_at = now()
  where workspace_id = p_workspace_id
    and purpose = p_purpose
    and state_hash = p_state_hash
    and consumed_at is null
    and created_at <= now()
    and expires_at >= now();
  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;
revoke all on function public.consume_billing_callback_nonce(uuid,text,text) from public, anon, authenticated;
grant execute on function public.consume_billing_callback_nonce(uuid,text,text) to service_role;

-- Atomic check-and-record trial fingerprint, single round trip. "bumped"
-- only fires when "inserted" produced no row (i.e. the fingerprint already
-- existed) because Postgres evaluates a referenced data-modifying CTE before
-- the CTE that references it.
create or replace function public.check_and_record_trial_fingerprint(
  requested_fingerprint_hash text,
  trusted_workspace_id uuid
) returns table (is_new boolean, first_seen_workspace_id uuid, first_seen_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if requested_fingerprint_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid fingerprint hash';
  end if;

  return query
  with inserted as (
    insert into private.trial_fraud_signals (fingerprint_hash, first_seen_workspace_id, first_seen_at)
    values (requested_fingerprint_hash, trusted_workspace_id, now())
    on conflict (fingerprint_hash) do nothing
    returning fingerprint_hash, first_seen_workspace_id, first_seen_at
  ),
  bumped as (
    update private.trial_fraud_signals signals
    set occurrence_count = signals.occurrence_count + 1
    where signals.fingerprint_hash = requested_fingerprint_hash
      and not exists (select 1 from inserted)
    returning signals.fingerprint_hash, signals.first_seen_workspace_id, signals.first_seen_at
  )
  select true, i.first_seen_workspace_id, i.first_seen_at from inserted i
  union all
  select false, b.first_seen_workspace_id, b.first_seen_at from bumped b;
end;
$$;
revoke all on function public.check_and_record_trial_fingerprint(text,uuid) from public, anon, authenticated;
grant execute on function public.check_and_record_trial_fingerprint(text,uuid) to service_role;

create or replace function public.transition_workspace_subscription(
  trusted_workspace_id uuid,
  trusted_new_status text,
  trusted_plan_id uuid,
  trusted_trial_ends_at timestamptz,
  trusted_current_period_ends_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
  current_status text;
  trial_already_consumed boolean;
begin
  if trusted_new_status not in ('incomplete','trialing','active','past_due','canceled') then
    raise exception 'invalid subscription status';
  end if;

  -- Lock the row: the eligibility decision below and the write that records it
  -- must not interleave with a concurrent transition, or two callers could
  -- each observe an unconsumed trial and both grant one.
  select status, trial_consumed_at is not null
    into current_status, trial_already_consumed
  from public.workspace_subscriptions
  where workspace_id = trusted_workspace_id
  for update;

  if current_status is null then
    return false;
  end if;

  -- Explicit state machine. Previously any status could move to any other, so
  -- an entitled state was reachable from anywhere. Anything not permitted here
  -- is refused, and refusal raises rather than returning false so that a caller
  -- which ignores the return value still fails loudly.
  if trusted_new_status = 'trialing' then
    if trial_already_consumed then
      raise exception 'workspace has already consumed its trial';
    end if;
    if current_status not in ('incomplete','canceled') then
      raise exception 'illegal subscription transition % -> %',
        current_status, trusted_new_status;
    end if;
  elsif trusted_new_status = 'past_due' then
    if current_status not in ('trialing','active','past_due') then
      raise exception 'illegal subscription transition % -> %',
        current_status, trusted_new_status;
    end if;
  elsif trusted_new_status = 'incomplete' then
    -- Only ever the initial state written by the workspace trigger.
    if current_status <> 'incomplete' then
      raise exception 'illegal subscription transition % -> %',
        current_status, trusted_new_status;
    end if;
  end if;
  -- 'active' and 'canceled' remain reachable from any live status: a customer
  -- may pay at any point, and may be cancelled at any point.

  update public.workspace_subscriptions
  set
    status = trusted_new_status,
    plan_id = coalesce(trusted_plan_id, plan_id),
    trial_ends_at = trusted_trial_ends_at,
    current_period_ends_at = trusted_current_period_ends_at,
    trial_consumed_at = case
      when trusted_new_status = 'trialing' then now()
      else trial_consumed_at
    end,
    canceled_at = case when trusted_new_status = 'canceled' then now() else canceled_at end,
    updated_at = now()
  where workspace_id = trusted_workspace_id;
  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;
revoke all on function public.transition_workspace_subscription(uuid,text,uuid,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.transition_workspace_subscription(uuid,text,uuid,timestamptz,timestamptz)
  to service_role;

-- Structural copy of ingest_meta_event: resolves the trusted workspace from
-- the charge attempt (never from a client-supplied id), dedupes by
-- (provider, provider_event_ref), and enqueues the outbox row atomically.
create or replace function public.ingest_billing_webhook_event(
  p_provider text,
  p_provider_event_ref text,
  p_charge_attempt_id uuid,
  p_event_type text,
  p_safe_payload jsonb,
  p_occurred_at timestamptz
) returns table (result text, webhook_event_id uuid, trusted_workspace_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt public.billing_charge_attempts;
  inserted_id uuid;
begin
  select * into attempt from public.billing_charge_attempts where id = p_charge_attempt_id;
  if attempt.id is null then
    return query select 'unknown_charge_attempt'::text, null::uuid, null::uuid;
    return;
  end if;

  insert into public.billing_webhook_events (
    workspace_id, provider, provider_event_ref, event_type, safe_payload, occurred_at
  )
  values (
    attempt.workspace_id, p_provider, p_provider_event_ref, p_event_type,
    coalesce(p_safe_payload, '{}'::jsonb), p_occurred_at
  )
  on conflict (provider, provider_event_ref) do nothing
  returning id into inserted_id;

  if inserted_id is null then
    return query select 'duplicate'::text, null::uuid, attempt.workspace_id;
    return;
  end if;

  insert into public.billing_provider_event_outbox (workspace_id, webhook_event_id, payload)
  values (
    attempt.workspace_id,
    inserted_id,
    jsonb_build_object(
      'webhookEventId', inserted_id,
      'trustedWorkspaceId', attempt.workspace_id,
      'chargeAttemptId', attempt.id,
      'provider', p_provider,
      'providerEventRef', p_provider_event_ref
    )
  );

  return query select 'accepted'::text, inserted_id, attempt.workspace_id;
end;
$$;
revoke all on function public.ingest_billing_webhook_event(text,text,uuid,text,jsonb,timestamptz)
  from public, anon, authenticated;
grant execute on function public.ingest_billing_webhook_event(text,text,uuid,text,jsonb,timestamptz)
  to service_role;

create or replace function public.purge_orphaned_billing_nonces(requested_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  if requested_limit not between 1 and 10000 then
    raise exception 'invalid cleanup limit';
  end if;
  with expired as (
    select id
    from public.billing_callback_nonces
    where expires_at <= clock_timestamp()
    order by expires_at
    limit requested_limit
    for update skip locked
  )
  delete from public.billing_callback_nonces nonces
  using expired
  where nonces.id = expired.id;
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.purge_orphaned_billing_nonces(integer) from public;
grant execute on function public.purge_orphaned_billing_nonces(integer) to service_role;

-- Seed the single V1 paid plan (499.00 TRY/month, minor units = kuruş).
insert into public.subscription_plans (plan_key, display_name, price_minor_units, currency)
values ('standard_monthly', 'Standard', 49900, 'TRY')
on conflict (plan_key) do nothing;

-- Every workspace gets a subscription row the moment it's created, seeded as
-- 'incomplete' (no trial yet — a trial only starts once a card is verified
-- via completeCardRegistration). Additive trigger on public.workspaces,
-- structural copy of initialize_business_profile_after_workspace; does not
-- touch private.handle_new_user() at all.
create or replace function private.initialize_workspace_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_plan_id uuid;
begin
  select id into default_plan_id
  from public.subscription_plans
  where plan_key = 'standard_monthly' and active
  limit 1;

  insert into public.workspace_subscriptions (workspace_id, plan_id, status)
  values (new.id, default_plan_id, 'incomplete')
  on conflict (workspace_id) do nothing;

  return new;
end;
$$;

create trigger initialize_workspace_subscription_after_workspace
after insert on public.workspaces
for each row execute function private.initialize_workspace_subscription();
