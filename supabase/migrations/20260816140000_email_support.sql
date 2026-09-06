-- P8 — Email delivery events, consent, and support tickets
--
-- The pack's flow is
--   action → validate + authorize → DB event/ticket → Inngest → provider →
--   delivery webhook → DB
-- and the ordering is the point. The durable row is written before the provider
-- is called, and the UI never waits on the provider. Someone whose password
-- reset appears to fail because the mail host was slow simply asks for another
-- one, and the second attempt is as likely to fail as the first.
--
-- The support ticket is the source of truth; the notification email about it is
-- a copy. Building it the other way round means the record of a customer's
-- problem lives in somebody's inbox.
--
-- No column here holds a recovery token, an OTP or a password. That is not an
-- oversight to be corrected later: variables are stored by name only, because a
-- token in a database row is readable by everybody with database access, which
-- is a far wider set than the one mailbox it was addressed to.

create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: an account-recovery email is sent to somebody who may not be able
  -- to reach any workspace, which is usually why they are recovering.
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  category text not null check (
    category in (
      'auth_verification', 'auth_recovery', 'security_alert', 'billing_notice',
      'support_reply', 'workspace_notification', 'lifecycle'
    )
  ),
  stream text not null check (stream in ('transactional', 'marketing')),
  template_id text not null check (char_length(template_id) between 1 and 80),
  -- Domain only. The local part identifies a person and is not needed to
  -- diagnose delivery.
  recipient_domain text not null check (char_length(recipient_domain) between 1 and 253),
  -- Names of the variables the template was rendered with. Never their values.
  variable_names text[] not null default '{}',
  locale text not null default 'en',
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  status text not null default 'pending'
    check (status in ('pending', 'queued', 'delivered', 'bounced', 'complained', 'failed')),
  provider text,
  provider_message_ref text,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (idempotency_key)
);

create index if not exists email_events_workspace_recent
  on public.email_events (workspace_id, created_at desc);
create index if not exists email_events_pending
  on public.email_events (created_at)
  where status = 'pending';

-- Marketing consent for account holders, distinct from public.customer_consents
-- which governs messaging a workspace's own customers. Conflating the two would
-- mean a workspace unsubscribing from our product emails silently stopped their
-- customers' WhatsApp replies.
create table if not exists public.email_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  marketing_consent boolean not null default false,
  consent_source text check (consent_source is null or char_length(consent_source) <= 80),
  unsubscribed_at timestamptz,
  -- Set on a hard bounce or a spam complaint. Applies to both streams: the
  -- address does not work, and continuing to send damages deliverability for
  -- every other recipient.
  suppressed_at timestamptz,
  suppression_reason text check (
    suppression_reason is null or suppression_reason in ('hard_bounce', 'complaint', 'manual')
  ),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  opened_by uuid references auth.users(id) on delete set null,
  subject text not null check (char_length(subject) between 1 and 200),
  status text not null default 'open'
    check (status in ('open', 'awaiting_customer', 'awaiting_support', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  -- Issued by us and required to correlate an inbound reply. A From header is
  -- trivially forged, so the sender address is corroboration and never
  -- authorization.
  correlation_token text not null check (char_length(correlation_token) between 16 and 128),
  assigned_to uuid references auth.users(id) on delete set null,
  first_response_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (correlation_token),
  unique (id, workspace_id)
);

create index if not exists support_tickets_workspace_open
  on public.support_tickets (workspace_id, created_at desc)
  where status not in ('resolved', 'closed');

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ticket_id uuid not null,
  author_kind text not null check (author_kind in ('customer', 'support', 'system')),
  author_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 10000),
  -- How an inbound message was proven to belong to this ticket. 'none' exists
  -- so an unverified message can be recorded for review without ever being
  -- treated as the ticket owner speaking.
  correlation_method text not null default 'none'
    check (correlation_method in ('none', 'token', 'message_id')),
  created_at timestamptz not null default now(),
  foreign key (ticket_id, workspace_id)
    references public.support_tickets(id, workspace_id) on delete cascade
);

create index if not exists support_ticket_messages_thread
  on public.support_ticket_messages (workspace_id, ticket_id, created_at);

alter table public.email_events enable row level security;
alter table public.email_events force row level security;
alter table public.email_consents enable row level security;
alter table public.email_consents force row level security;
alter table public.support_tickets enable row level security;
alter table public.support_tickets force row level security;
alter table public.support_ticket_messages enable row level security;
alter table public.support_ticket_messages force row level security;

revoke all on public.email_events from anon, authenticated;
revoke all on public.email_consents from anon, authenticated;
revoke all on public.support_tickets from anon, authenticated;
revoke all on public.support_ticket_messages from anon, authenticated;

grant all on public.email_events to service_role;
grant all on public.email_consents to service_role;
grant all on public.support_tickets to service_role;
grant all on public.support_ticket_messages to service_role;

grant select on public.email_events to authenticated;
grant select on public.support_ticket_messages to authenticated;

-- Column-level, deliberately, and not `grant select on public.support_tickets`
-- followed by a revoke: a table-level grant covers every column, and revoking
-- one column afterwards silently does nothing. The correlation token is a
-- bearer credential for the ticket thread, so the browser never receives it.
grant select (
  id, workspace_id, opened_by, subject, status, priority, assigned_to,
  first_response_at, resolved_at, created_at, updated_at
) on public.support_tickets to authenticated;
-- Consent is the one thing a user may change about themselves directly; an
-- unsubscribe that needs a support request is not an unsubscribe.
grant select, update on public.email_consents to authenticated;

create policy email_events_select_member on public.email_events
  for select to authenticated
  using (workspace_id is not null and private.is_active_member(workspace_id));

create policy email_consents_select_own on public.email_consents
  for select to authenticated
  using (user_id = auth.uid());

create policy email_consents_update_own on public.email_consents
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy support_tickets_select_member on public.support_tickets
  for select to authenticated
  using (private.is_active_member(workspace_id));

create policy support_ticket_messages_select_member on public.support_ticket_messages
  for select to authenticated
  using (private.is_active_member(workspace_id));
