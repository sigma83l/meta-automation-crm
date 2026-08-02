-- Neon Preview compatibility boundary.
-- Keeps the accepted application schema and RLS migrations portable while
-- Managed Better Auth replaces Supabase Auth. This does not implement object
-- storage; media remains behind the existing provider adapter and is disabled
-- until a hosted object-storage target is configured.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

create schema if not exists extensions;
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id) on delete cascade,
  name text not null,
  owner_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, name)
);

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
strict
as $$
  select case
    when array_length(string_to_array(name, '/'), 1) > 1
      then (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
    else array[]::text[]
  end
$$;

alter table storage.objects enable row level security;
alter table storage.objects force row level security;
grant usage on schema auth, storage to authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant all on storage.buckets, storage.objects to service_role;

comment on table storage.objects is
  'Metadata compatibility table only; object bytes require the configured storage adapter.';
