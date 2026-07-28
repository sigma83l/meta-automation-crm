-- Prompt 3: structured business knowledge and encrypted workspace AI credentials.
create type public.ai_provider_mode as enum ('PLATFORM_PAID_DEFAULT','WORKSPACE_BYOK_GEMINI','WORKSPACE_BYOK_OPENAI','WORKSPACE_BYOK_ANTHROPIC','FREE_GEMINI_DEMO_SYNTHETIC_ONLY');

create table public.business_profiles (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  brand_name text not null check (length(trim(brand_name)) between 1 and 120),
  description text not null default '' check (length(description) <= 4000),
  primary_language text not null default 'en',
  fallback_language text not null default 'en',
  tone text not null default 'friendly' check (tone in ('friendly','formal')),
  answer_length text not null default 'short' check (answer_length in ('short','medium')),
  emoji_policy text not null default 'limited' check (emoji_policy in ('allowed','limited','off')),
  business_hours jsonb not null default '{}'::jsonb,
  timezone text not null default 'UTC',
  forbidden_claims text[] not null default '{}',
  escalation_keywords text[] not null default '{}',
  low_confidence_threshold numeric(4,3) not null default 0.650 check (low_confidence_threshold between 0 and 1),
  retention_days integer not null default 365 check (retention_days between 1 and 3650),
  ai_mode public.ai_provider_mode not null default 'PLATFORM_PAID_DEFAULT',
  demo_mode_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.business_faq_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  question text not null check (length(trim(question)) between 1 and 500),
  answer text not null check (length(trim(answer)) between 1 and 4000),
  language text not null default 'en', enabled boolean not null default true,
  created_at timestamptz not null default now(), unique (workspace_id,id)
);
create table public.business_price_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  description text not null default '', amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  availability text not null default 'ask_human' check (availability in ('available','unavailable','ask_human')),
  enabled boolean not null default true, created_at timestamptz not null default now(),
  unique (workspace_id,id)
);
create table public.workspace_ai_credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('gemini','openai','anthropic')),
  ciphertext text not null, iv text not null, auth_tag text not null,
  key_version integer not null check (key_version > 0),
  masked_suffix text not null check (masked_suffix ~ '^[A-Za-z0-9_-]{4}$'),
  status text not null default 'untested' check (status in ('untested','active','invalid','disabled')),
  tested_at timestamptz, rotated_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id,provider), unique (workspace_id,id)
);
create table public.ai_execution_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null, provider text, status text not null,
  safe_details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['business_profiles','business_faq_items','business_price_items','workspace_ai_credentials','ai_execution_audit_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
  end loop;
end $$;
grant select,insert,update,delete on public.business_profiles,public.business_faq_items,public.business_price_items to authenticated;
grant select(workspace_id,provider,status,masked_suffix,key_version,tested_at,rotated_at) on public.workspace_ai_credentials to authenticated;
grant select on public.ai_execution_audit_events to authenticated;
grant all on public.business_profiles,public.business_faq_items,public.business_price_items,public.workspace_ai_credentials,public.ai_execution_audit_events to service_role;
do $$ declare t text; begin
  foreach t in array array['business_profiles','business_faq_items','business_price_items'] loop
    execute format('create policy %I on public.%I for select to authenticated using (private.is_active_member(workspace_id))',t||'_select_member',t);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.is_active_member(workspace_id))',t||'_insert_member',t);
    execute format('create policy %I on public.%I for update to authenticated using (private.is_active_member(workspace_id)) with check (private.is_active_member(workspace_id))',t||'_update_member',t);
    execute format('create policy %I on public.%I for delete to authenticated using (private.is_active_member(workspace_id))',t||'_delete_member',t);
  end loop;
end $$;
create policy workspace_ai_credentials_select_member on public.workspace_ai_credentials for select to authenticated using (private.is_active_member(workspace_id));
create policy ai_execution_audit_select_member on public.ai_execution_audit_events for select to authenticated using (private.is_active_member(workspace_id));

insert into public.business_profiles (workspace_id,brand_name,timezone)
select w.id,w.name,coalesce(s.timezone,'UTC') from public.workspaces w left join public.workspace_settings s on s.workspace_id=w.id
on conflict (workspace_id) do nothing;
create or replace function private.initialize_business_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.business_profiles(workspace_id,brand_name) values(new.id,new.name) on conflict(workspace_id) do nothing; return new; end; $$;
create trigger initialize_business_profile_after_workspace after insert on public.workspaces for each row execute function private.initialize_business_profile();
comment on table public.workspace_ai_credentials is 'Server-managed AES-256-GCM envelopes only. Plaintext credentials are prohibited.';
