-- Prompt 2: fresh workspace-scoped CRM, inbox, private media, and export schema.

create type public.customer_status as enum ('active', 'archived');
create type public.consent_status as enum ('granted', 'denied', 'revoked', 'unknown');
create type public.conversation_state as enum ('open', 'closed');
create type public.conversation_owner as enum ('automation', 'human');
create type public.message_direction as enum ('inbound', 'outbound');
create type public.message_status as enum ('received', 'prepared', 'failed');
create type public.export_status as enum ('pending', 'processing', 'ready', 'failed', 'expired');

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  company_name text check (company_name is null or char_length(btrim(company_name)) between 1 and 120),
  status public.customer_status not null default 'active',
  source text not null default 'manual' check (char_length(source) between 1 and 40),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create table public.customer_channel_identities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  channel text not null check (channel in ('instagram', 'whatsapp')),
  external_id text not null check (char_length(external_id) between 1 and 255),
  username text check (username is null or char_length(username) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (workspace_id, channel, external_id),
  foreign key (customer_id, workspace_id) references public.customers(id, workspace_id) on delete cascade,
  unique (id, workspace_id)
);

create table public.customer_contact_methods (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  kind text not null check (kind in ('email', 'phone')),
  value text not null check (char_length(value) between 3 and 254),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (customer_id, workspace_id) references public.customers(id, workspace_id) on delete cascade,
  unique (id, workspace_id)
);

create table public.customer_consents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  channel text not null check (channel in ('email', 'instagram', 'whatsapp')),
  status public.consent_status not null default 'unknown',
  opt_out boolean not null default false,
  lawful_basis text,
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (customer_id, workspace_id) references public.customers(id, workspace_id) on delete cascade,
  unique (workspace_id, customer_id, channel),
  unique (id, workspace_id)
);

create table public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  field_type text not null check (field_type in ('text', 'number', 'boolean', 'date')),
  created_at timestamptz not null default now(),
  unique (workspace_id, field_key),
  unique (id, workspace_id)
);

create table public.customer_custom_field_values (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  definition_id uuid not null,
  value jsonb not null check (jsonb_typeof(value) in ('string', 'number', 'boolean')),
  updated_at timestamptz not null default now(),
  foreign key (customer_id, workspace_id) references public.customers(id, workspace_id) on delete cascade,
  foreign key (definition_id, workspace_id) references public.custom_field_definitions(id, workspace_id) on delete cascade,
  unique (workspace_id, customer_id, definition_id),
  unique (id, workspace_id)
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 50),
  color text not null default '#647680' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  unique (workspace_id, name),
  unique (id, workspace_id)
);

create table public.customer_tag_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  tag_id uuid not null,
  assigned_at timestamptz not null default now(),
  foreign key (customer_id, workspace_id) references public.customers(id, workspace_id) on delete cascade,
  foreign key (tag_id, workspace_id) references public.tags(id, workspace_id) on delete cascade,
  unique (workspace_id, customer_id, tag_id),
  unique (id, workspace_id)
);

create table public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (customer_id, workspace_id) references public.customers(id, workspace_id) on delete cascade,
  unique (id, workspace_id)
);

create table public.customer_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  activity_type text not null check (char_length(activity_type) between 1 and 80),
  summary text not null check (char_length(summary) between 1 and 500),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  foreign key (customer_id, workspace_id) references public.customers(id, workspace_id) on delete cascade,
  unique (id, workspace_id)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  channel text not null check (channel in ('instagram', 'whatsapp')),
  state public.conversation_state not null default 'open',
  owner public.conversation_owner not null default 'automation',
  unread_count integer not null default 0 check (unread_count >= 0),
  requires_human_review boolean not null default false,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (customer_id, workspace_id) references public.customers(id, workspace_id) on delete cascade,
  unique (id, workspace_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null,
  customer_id uuid not null,
  direction public.message_direction not null,
  status public.message_status not null,
  body text not null default '' check (char_length(body) <= 10000),
  provider_message_id text,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (conversation_id, workspace_id) references public.conversations(id, workspace_id) on delete cascade,
  foreign key (customer_id, workspace_id) references public.customers(id, workspace_id) on delete cascade,
  unique (workspace_id, provider_message_id),
  unique (id, workspace_id)
);

create table public.customer_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  bucket_id text not null default 'customer-media' check (bucket_id = 'customer-media'),
  object_path text not null,
  original_name text not null check (char_length(original_name) between 1 and 255),
  safe_name text not null check (safe_name !~ '[/\\]'),
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  retention_until timestamptz,
  deleted_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (customer_id, workspace_id) references public.customers(id, workspace_id) on delete cascade,
  unique (workspace_id, object_path),
  unique (id, workspace_id)
);

create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  message_id uuid not null,
  customer_file_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (message_id, workspace_id) references public.messages(id, workspace_id) on delete cascade,
  foreign key (customer_file_id, workspace_id) references public.customer_files(id, workspace_id) on delete cascade,
  unique (workspace_id, message_id, customer_file_id),
  unique (id, workspace_id)
);

create table public.customer_automation_references (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  automation_key text not null check (char_length(automation_key) between 1 and 120),
  source_reference text check (source_reference is null or char_length(source_reference) <= 255),
  state text not null default 'inactive' check (state in ('inactive', 'active', 'paused', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (customer_id, workspace_id) references public.customers(id, workspace_id) on delete cascade,
  unique (id, workspace_id)
);

create table public.crm_audit_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  customer_id uuid,
  action text not null check (char_length(action) between 1 and 100),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  foreign key (customer_id, workspace_id) references public.customers(id, workspace_id) on delete restrict
);

create table public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  status public.export_status not null default 'pending',
  scope text not null check (scope in ('one', 'selected', 'filtered', 'workspace')),
  filter_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(filter_snapshot) = 'object'),
  object_path text,
  row_count integer not null default 0 check (row_count >= 0),
  file_count integer not null default 0 check (file_count >= 0),
  byte_size bigint not null default 0 check (byte_size >= 0),
  expires_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, workspace_id)
);

create index customers_workspace_search_idx on public.customers(workspace_id, status, display_name);
create index conversations_workspace_recent_idx on public.conversations(workspace_id, last_message_at desc);
create index messages_conversation_time_idx on public.messages(workspace_id, conversation_id, sent_at);
create index activities_customer_time_idx on public.customer_activities(workspace_id, customer_id, occurred_at desc);
create index files_customer_idx on public.customer_files(workspace_id, customer_id, deleted_at);
create index exports_expiry_idx on public.export_jobs(workspace_id, expires_at);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'customers', 'customer_channel_identities', 'customer_contact_methods',
    'customer_consents', 'custom_field_definitions', 'customer_custom_field_values',
    'tags', 'customer_tag_assignments', 'customer_notes', 'customer_activities',
    'conversations', 'messages', 'customer_files', 'message_attachments',
    'customer_automation_references', 'crm_audit_events', 'export_jobs'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.is_active_member(workspace_id))',
      table_name || '_select_member', table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (private.is_active_member(workspace_id))',
      table_name || '_insert_member', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (private.is_active_member(workspace_id)) with check (private.is_active_member(workspace_id))',
      table_name || '_update_member', table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (private.is_active_member(workspace_id))',
      table_name || '_delete_member', table_name
    );
  end loop;
end;
$$;

grant usage, select on all sequences in schema public to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('customer-media', 'customer-media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('crm-exports', 'crm-exports', false, 104857600, array['application/zip'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy customer_media_select_member on storage.objects for select to authenticated
using (bucket_id = 'customer-media' and private.is_active_member(private.try_uuid((storage.foldername(name))[1])));
create policy customer_media_insert_member on storage.objects for insert to authenticated
with check (bucket_id = 'customer-media' and private.is_active_member(private.try_uuid((storage.foldername(name))[1])));
create policy customer_media_update_member on storage.objects for update to authenticated
using (bucket_id = 'customer-media' and private.is_active_member(private.try_uuid((storage.foldername(name))[1])))
with check (bucket_id = 'customer-media' and private.is_active_member(private.try_uuid((storage.foldername(name))[1])));
create policy customer_media_delete_member on storage.objects for delete to authenticated
using (bucket_id = 'customer-media' and private.is_active_member(private.try_uuid((storage.foldername(name))[1])));

create policy crm_exports_select_member on storage.objects for select to authenticated
using (bucket_id = 'crm-exports' and private.is_active_member(private.try_uuid((storage.foldername(name))[1])));
create policy crm_exports_insert_member on storage.objects for insert to authenticated
with check (bucket_id = 'crm-exports' and private.is_active_member(private.try_uuid((storage.foldername(name))[1])));
create policy crm_exports_update_member on storage.objects for update to authenticated
using (bucket_id = 'crm-exports' and private.is_active_member(private.try_uuid((storage.foldername(name))[1])))
with check (bucket_id = 'crm-exports' and private.is_active_member(private.try_uuid((storage.foldername(name))[1])));
create policy crm_exports_delete_member on storage.objects for delete to authenticated
using (bucket_id = 'crm-exports' and private.is_active_member(private.try_uuid((storage.foldername(name))[1])));
