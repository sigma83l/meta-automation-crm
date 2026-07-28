-- Prompt 1: fresh authentication, workspace isolation, RLS, and private Storage.
-- This migration contains no donor schema or migration history.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.account_status as enum ('active', 'disabled');
create type public.workspace_status as enum ('active', 'disabled');
create type public.membership_role as enum ('owner');
create type public.membership_status as enum ('active', 'disabled');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  status public.workspace_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  status public.account_status not null default 'active',
  display_name text check (display_name is null or char_length(btrim(display_name)) between 2 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.membership_role not null default 'owner',
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table public.workspace_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  email_confirmation_enabled boolean not null default false,
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.onboarding_states (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  current_step text not null default 'auth-complete',
  completed_steps text[] not null default array['account-created']::text[],
  auth_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table public.auth_audit_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'signup_succeeded',
      'login_succeeded',
      'logout_succeeded',
      'logout_all_succeeded',
      'password_reset_requested',
      'password_reset_completed',
      'session_refreshed',
      'account_disabled_blocked'
    )
  ),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now()
);

create index workspace_memberships_user_idx
  on public.workspace_memberships(user_id, status, workspace_id);
create index auth_audit_events_workspace_time_idx
  on public.auth_audit_events(workspace_id, occurred_at desc);

alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.workspace_settings enable row level security;
alter table public.onboarding_states enable row level security;
alter table public.auth_audit_events enable row level security;

alter table public.workspaces force row level security;
alter table public.profiles force row level security;
alter table public.workspace_memberships force row level security;
alter table public.workspace_settings force row level security;
alter table public.onboarding_states force row level security;
alter table public.auth_audit_events force row level security;

revoke all on table public.workspaces from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.workspace_memberships from anon, authenticated;
revoke all on table public.workspace_settings from anon, authenticated;
revoke all on table public.onboarding_states from anon, authenticated;
revoke all on table public.auth_audit_events from anon, authenticated;

grant select on table public.workspaces to authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;
grant select on table public.workspace_memberships to authenticated;
grant select on table public.workspace_settings to authenticated;
grant update (timezone) on table public.workspace_settings to authenticated;
grant select on table public.onboarding_states to authenticated;
grant select on table public.auth_audit_events to authenticated;
grant all on table
  public.workspaces,
  public.profiles,
  public.workspace_memberships,
  public.workspace_settings,
  public.onboarding_states,
  public.auth_audit_events
to service_role;
grant usage, select on all sequences in schema public to service_role;

create or replace function private.try_uuid(value text)
returns uuid
language plpgsql
immutable
strict
set search_path = ''
as $$
begin
  return value::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

create or replace function private.is_active_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_memberships membership
    join public.profiles profile
      on profile.id = membership.user_id
      and profile.workspace_id = membership.workspace_id
    join public.workspaces workspace
      on workspace.id = membership.workspace_id
    where membership.user_id = (select auth.uid())
      and membership.workspace_id = target_workspace_id
      and membership.status = 'active'
      and profile.status = 'active'
      and workspace.status = 'active'
  );
$$;

create or replace function private.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_memberships membership
    where membership.user_id = (select auth.uid())
      and membership.workspace_id = target_workspace_id
      and membership.role = 'owner'
      and membership.status = 'active'
      and private.is_active_member(target_workspace_id)
  );
$$;

create policy workspaces_select_member
on public.workspaces for select
to authenticated
using (private.is_active_member(id));

create policy profiles_select_member
on public.profiles for select
to authenticated
using (private.is_active_member(workspace_id));

create policy profiles_update_self
on public.profiles for update
to authenticated
using (
  id = (select auth.uid())
  and private.is_active_member(workspace_id)
)
with check (
  id = (select auth.uid())
  and private.is_active_member(workspace_id)
);

create policy memberships_select_member
on public.workspace_memberships for select
to authenticated
using (private.is_active_member(workspace_id));

create policy workspace_settings_select_member
on public.workspace_settings for select
to authenticated
using (private.is_active_member(workspace_id));

create policy workspace_settings_update_owner
on public.workspace_settings for update
to authenticated
using (private.is_workspace_owner(workspace_id))
with check (private.is_workspace_owner(workspace_id));

create policy onboarding_select_member
on public.onboarding_states for select
to authenticated
using (
  user_id = (select auth.uid())
  and private.is_active_member(workspace_id)
);

create policy audit_select_owner
on public.auth_audit_events for select
to authenticated
using (private.is_workspace_owner(workspace_id));

create or replace function public.resolve_workspace(workspace_hint uuid default null)
returns table (
  workspace_id uuid,
  workspace_name text,
  account_status public.account_status,
  onboarding_complete boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    workspace.id,
    workspace.name,
    profile.status,
    onboarding.auth_completed_at is not null
  from public.workspace_memberships membership
  join public.workspaces workspace on workspace.id = membership.workspace_id
  join public.profiles profile
    on profile.id = membership.user_id
    and profile.workspace_id = membership.workspace_id
  join public.onboarding_states onboarding
    on onboarding.workspace_id = membership.workspace_id
    and onboarding.user_id = membership.user_id
  where membership.user_id = (select auth.uid())
    and membership.status = 'active'
    and workspace.status = 'active'
    and profile.status = 'active'
    and (workspace_hint is null or workspace_hint = workspace.id)
  limit 1;
$$;

create or replace function public.record_auth_audit(
  requested_event_type text,
  requested_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_workspace_id uuid;
  inserted_id bigint;
begin
  if requested_event_type not in (
    'signup_succeeded',
    'login_succeeded',
    'logout_succeeded',
    'logout_all_succeeded',
    'password_reset_requested',
    'password_reset_completed',
    'session_refreshed',
    'account_disabled_blocked'
  ) then
    raise exception 'unsupported audit event';
  end if;

  if jsonb_typeof(coalesce(requested_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'audit metadata must be an object';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(coalesce(requested_metadata, '{}'::jsonb)) key
    where lower(key) ~ '(token|secret|password|authorization|cookie|session)'
  ) then
    raise exception 'audit metadata contains a forbidden key';
  end if;

  select membership.workspace_id
  into resolved_workspace_id
  from public.workspace_memberships membership
  where membership.user_id = (select auth.uid())
    and membership.status = 'active'
  limit 1;

  if resolved_workspace_id is null
    or not private.is_active_member(resolved_workspace_id) then
    raise exception 'active workspace membership required';
  end if;

  insert into public.auth_audit_events (
    workspace_id,
    user_id,
    event_type,
    metadata
  )
  values (
    resolved_workspace_id,
    (select auth.uid()),
    requested_event_type,
    coalesce(requested_metadata, '{}'::jsonb)
  )
  returning id into inserted_id;

  return inserted_id;
end;
$$;

create or replace function public.complete_auth_onboarding()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_workspace_id uuid;
begin
  select membership.workspace_id
  into resolved_workspace_id
  from public.workspace_memberships membership
  where membership.user_id = (select auth.uid())
    and membership.status = 'active'
  limit 1;

  if resolved_workspace_id is null
    or not private.is_active_member(resolved_workspace_id) then
    raise exception 'active workspace membership required';
  end if;

  update public.onboarding_states
  set
    auth_completed_at = coalesce(auth_completed_at, now()),
    completed_steps = (
      select array_agg(distinct step order by step)
      from unnest(completed_steps || array['auth-complete']) step
    ),
    updated_at = now()
  where workspace_id = resolved_workspace_id
    and user_id = (select auth.uid());
end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_name text;
  new_workspace_id uuid;
begin
  workspace_name := btrim(coalesce(new.raw_user_meta_data ->> 'business_name', ''));

  if char_length(workspace_name) not between 2 and 80 then
    raise exception 'business name must contain between 2 and 80 characters';
  end if;

  insert into public.workspaces (name)
  values (workspace_name)
  returning id into new_workspace_id;

  insert into public.profiles (id, workspace_id)
  values (new.id, new_workspace_id);

  insert into public.workspace_memberships (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  insert into public.workspace_settings (
    workspace_id,
    email_confirmation_enabled
  )
  values (new_workspace_id, false);

  insert into public.onboarding_states (workspace_id, user_id)
  values (new_workspace_id, new.id);

  insert into public.auth_audit_events (
    workspace_id,
    user_id,
    event_type,
    metadata
  )
  values (
    new_workspace_id,
    new.id,
    'signup_succeeded',
    jsonb_build_object('source', 'database-trigger')
  );

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

grant execute on function public.resolve_workspace(uuid) to authenticated;
grant execute on function public.record_auth_audit(text, jsonb) to authenticated;
grant execute on function public.complete_auth_onboarding() to authenticated;
grant usage on schema private to authenticated;
grant execute on function private.try_uuid(text) to authenticated;
grant execute on function private.is_active_member(uuid) to authenticated;
grant execute on function private.is_workspace_owner(uuid) to authenticated;
revoke all on function private.try_uuid(text) from public, anon, authenticated;
revoke all on function private.is_active_member(uuid) from public, anon, authenticated;
revoke all on function private.is_workspace_owner(uuid) from public, anon, authenticated;
revoke all on function private.handle_new_user() from public, anon, authenticated;
grant execute on function private.try_uuid(text) to authenticated;
grant execute on function private.is_active_member(uuid) to authenticated;
grant execute on function private.is_workspace_owner(uuid) to authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'crm-private',
  'crm-private',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy crm_private_select_member
on storage.objects for select
to authenticated
using (
  bucket_id = 'crm-private'
  and private.is_active_member(
    private.try_uuid((storage.foldername(name))[1])
  )
);

create policy crm_private_insert_member
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'crm-private'
  and private.is_active_member(
    private.try_uuid((storage.foldername(name))[1])
  )
);

create policy crm_private_update_member
on storage.objects for update
to authenticated
using (
  bucket_id = 'crm-private'
  and private.is_active_member(
    private.try_uuid((storage.foldername(name))[1])
  )
)
with check (
  bucket_id = 'crm-private'
  and private.is_active_member(
    private.try_uuid((storage.foldername(name))[1])
  )
);

create policy crm_private_delete_member
on storage.objects for delete
to authenticated
using (
  bucket_id = 'crm-private'
  and private.is_active_member(
    private.try_uuid((storage.foldername(name))[1])
  )
);
