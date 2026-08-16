-- Minimal stand-ins for objects created by earlier migrations, so a single
-- migration can be applied and exercised in isolation against a real Postgres
-- without the full Supabase stack. Deliberately not a reproduction of the real
-- schema: only enough surface for the migration under test to apply and for its
-- own logic to be observable.

create role anon;
create role authenticated;
create role service_role;

create schema if not exists auth;
create schema if not exists private;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'workspace'
);

create table public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',
  status text not null default 'active',
  primary key (workspace_id, user_id)
);

-- Returns null, as in platform-stub.sql: these replays check structure and
-- privileges, not per-request identity. A policy that calls auth.uid() must
-- still be creatable, which is what this exists for.
create or replace function auth.uid() returns uuid language sql stable as $$
  select null::uuid
$$;

create or replace function private.is_active_member(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = target_workspace_id and m.status = 'active'
  );
$$;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  return new;
end;
$$;
