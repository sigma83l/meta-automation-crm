-- Prompt 4: workspace Meta connections, verified webhook idempotency and outbox.
create table public.meta_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','instagram')),
  mode text not null default 'sandbox' check (mode in ('sandbox','live')),
  status text not null default 'pending' check (status in ('pending','active','disabled','reauth_required','disconnected')),
  provider_account_id text not null,
  display_name text not null default '',
  waba_id text,
  phone_number_id text,
  instagram_account_id text,
  permissions text[] not null default '{}',
  webhook_message_subscribed boolean not null default false,
  webhook_comment_subscribed boolean not null default false,
  token_ciphertext text,
  token_iv text,
  token_auth_tag text,
  token_key_version integer,
  token_masked_suffix text,
  token_expires_at timestamptz,
  last_health_status text not null default 'unknown' check (last_health_status in ('unknown','healthy','degraded','expired')),
  last_health_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel,provider_account_id),
  unique (workspace_id,channel)
);
create table public.meta_webhook_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid not null references public.meta_connections(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','instagram')),
  provider_event_id text not null,
  event_type text not null,
  sender_ref text,
  provider_message_ref text,
  text_summary text,
  attachment_metadata jsonb not null default '[]'::jsonb,
  status_metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  processing_status text not null default 'accepted' check (processing_status in ('accepted','processed','rejected')),
  unique (channel,provider_event_id)
);
create table public.provider_event_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  webhook_event_id uuid not null unique references public.meta_webhook_events(id) on delete cascade,
  event_name text not null default 'meta/webhook.received',
  payload jsonb not null,
  emitted_at timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);
create table public.meta_connection_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  connection_id uuid references public.meta_connections(id) on delete set null,
  event_type text not null,
  safe_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['meta_connections','meta_webhook_events','provider_event_outbox','meta_connection_audit_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
grant select(workspace_id,id,channel,mode,status,provider_account_id,display_name,waba_id,phone_number_id,instagram_account_id,permissions,webhook_message_subscribed,webhook_comment_subscribed,token_masked_suffix,token_expires_at,last_health_status,last_health_checked_at,created_at,updated_at) on public.meta_connections to authenticated;
grant select on public.meta_webhook_events,public.meta_connection_audit_events to authenticated;
create policy meta_connections_select_member on public.meta_connections for select to authenticated using(private.is_active_member(workspace_id));
create policy meta_webhook_events_select_member on public.meta_webhook_events for select to authenticated using(private.is_active_member(workspace_id));
create policy meta_connection_audit_select_member on public.meta_connection_audit_events for select to authenticated using(private.is_active_member(workspace_id));
comment on table public.provider_event_outbox is 'Durable meta/webhook.received emission seam; one row per accepted webhook event.';

create or replace function public.ingest_meta_event(
  p_channel text, p_provider_account_id text, p_provider_event_id text,
  p_event_type text, p_sender_ref text, p_provider_message_ref text,
  p_text_summary text, p_attachment_metadata jsonb, p_status_metadata jsonb,
  p_occurred_at timestamptz
) returns table(result text, webhook_event_id uuid, trusted_workspace_id uuid)
language plpgsql security definer set search_path='' as $$
declare c public.meta_connections; inserted_id uuid;
begin
  select * into c from public.meta_connections
  where channel=p_channel and provider_account_id=p_provider_account_id;
  if c.id is null then return query select 'unknown_connection'::text,null::uuid,null::uuid; return; end if;
  if c.status <> 'active' then return query select c.status::text,null::uuid,c.workspace_id; return; end if;
  insert into public.meta_webhook_events(workspace_id,connection_id,channel,provider_event_id,event_type,sender_ref,provider_message_ref,text_summary,attachment_metadata,status_metadata,occurred_at)
  values(c.workspace_id,c.id,p_channel,p_provider_event_id,p_event_type,p_sender_ref,p_provider_message_ref,left(p_text_summary,500),coalesce(p_attachment_metadata,'[]'::jsonb),coalesce(p_status_metadata,'{}'::jsonb),p_occurred_at)
  on conflict(channel,provider_event_id) do nothing returning id into inserted_id;
  if inserted_id is null then return query select 'duplicate'::text,null::uuid,c.workspace_id; return; end if;
  insert into public.provider_event_outbox(workspace_id,webhook_event_id,payload)
  values(c.workspace_id,inserted_id,jsonb_build_object('webhookEventId',inserted_id,'trustedWorkspaceId',c.workspace_id,'channel',p_channel,'providerEventId',p_provider_event_id));
  return query select 'accepted'::text,inserted_id,c.workspace_id;
end; $$;
revoke all on function public.ingest_meta_event(text,text,text,text,text,text,text,jsonb,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.ingest_meta_event(text,text,text,text,text,text,text,jsonb,jsonb,timestamptz) to service_role;
