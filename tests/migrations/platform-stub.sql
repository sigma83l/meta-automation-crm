-- Minimal stand-ins for the objects Supabase provides before any project
-- migration runs: the three PostgREST roles, the auth schema, and the storage
-- schema. Migrations may assume these exist; everything else they must create
-- themselves, which is precisely what the full-chain replay verifies.
--
-- pgcrypto is deliberately absent. The migrations declare it but use nothing
-- from it beyond gen_random_uuid(), which has been core Postgres since 13, so
-- the replay strips the declaration rather than faking the extension.

create role anon;
create role authenticated;
create role service_role;

create schema if not exists auth;
create schema if not exists private;
create schema if not exists extensions;
create schema if not exists storage;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Returns null here: the replay checks structure, not per-request identity.
create or replace function auth.uid() returns uuid language sql stable as $$
  select null::uuid
$$;

create table storage.buckets (
  id text primary key,
  name text,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/')
$$;
