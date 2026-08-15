-- P3 — provider connection state machine
--
-- The pack requires provider state to be a state machine rather than a
-- boolean, and names two conditions the model could not express:
--
--   degraded        the connection still works but is unhealthy - refresh
--                   failures, elevated provider errors, partial capability.
--   policy_blocked  the provider has restricted the account. Nothing is wrong
--                   with our credentials; sending is not permitted.
--
-- Existing names are kept. The pack's own reconciliation rule is to extend
-- equivalent production objects rather than duplicate them, and renaming
-- pending/active/disabled would churn live rows and every call site for no
-- behavioural gain.
--
-- The substantive change is which states accept inbound. ingest_meta_event
-- admitted only 'active', so a connection marked degraded would have silently
-- dropped customer messages - the same class of loss as the batching defect,
-- arriving through a different door. Degraded means impaired, not absent.

alter table public.meta_connections
  drop constraint if exists meta_connections_status_check;

alter table public.meta_connections
  add constraint meta_connections_status_check
  check (
    status in (
      'pending',
      'active',
      'degraded',
      'policy_blocked',
      'disabled',
      'reauth_required',
      'disconnected'
    )
  );

-- Recreated to widen the ingestion predicate. Everything else is unchanged:
-- the connection is still resolved by (channel, provider_account_id) so the
-- payload can never select a tenant, dedupe still runs on
-- (channel, provider_event_id), and the outbox row is still enqueued in the
-- same transaction as the event.
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
  where channel = p_channel and provider_account_id = p_provider_account_id;
  if c.id is null then return query select 'unknown_connection'::text,null::uuid,null::uuid; return; end if;

  -- A live connection accepts inbound. 'degraded' is live: the impairment is
  -- ours to fix, and refusing the message would lose the customer's words
  -- rather than surface our problem. 'policy_blocked' does not accept, because
  -- the provider has withdrawn permission for this account.
  if c.status not in ('active','degraded') then
    return query select c.status::text,null::uuid,c.workspace_id; return;
  end if;

  insert into public.meta_webhook_events(workspace_id,connection_id,channel,provider_event_id,event_type,sender_ref,provider_message_ref,text_summary,attachment_metadata,status_metadata,occurred_at)
  values(c.workspace_id,c.id,p_channel,p_provider_event_id,p_event_type,p_sender_ref,p_provider_message_ref,left(p_text_summary,500),coalesce(p_attachment_metadata,'[]'::jsonb),coalesce(p_status_metadata,'{}'::jsonb),p_occurred_at)
  on conflict(channel,provider_event_id) do nothing returning id into inserted_id;
  if inserted_id is null then return query select 'duplicate'::text,null::uuid,c.workspace_id; return; end if;

  insert into public.provider_event_outbox(workspace_id,webhook_event_id,payload)
  values(c.workspace_id,inserted_id,jsonb_build_object('webhookEventId',inserted_id,'trustedWorkspaceId',c.workspace_id,'channel',p_channel,'providerEventId',p_provider_event_id));
  return query select 'accepted'::text,inserted_id,c.workspace_id;
end; $$;

revoke all on function public.ingest_meta_event(
  text,text,text,text,text,text,text,jsonb,jsonb,timestamptz
) from public, anon, authenticated;
grant execute on function public.ingest_meta_event(
  text,text,text,text,text,text,text,jsonb,jsonb,timestamptz
) to service_role;
