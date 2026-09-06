-- Projects a verified provider event into the CRM.
--
-- Until now the inbound path stopped at `meta_webhook_events`: a message was
-- verified, normalised, deduplicated, routed to a workspace, relayed through
-- the outbox — and then marked 'processed' without anything reading it. No code
-- path in the repository has ever written `conversations` or `messages`, so
-- /inbox and /crm were structurally empty in every environment, including
-- production. This is the missing projection.
--
-- It lives in the database rather than in the handler because the four writes
-- (identity, customer, conversation, message) have to succeed or fail together.
-- A handler doing them over four round trips can be interrupted between any
-- two, and the visible result is a customer with no conversation or a
-- conversation with no message - states nothing else in the system knows how to
-- repair.

-- ---------------------------------------------------------------------------
-- An inbound customer has no author.
-- ---------------------------------------------------------------------------
--
-- `created_by` was NOT NULL against auth.users, which suited a CRM whose rows
-- were all typed in by somebody. A customer who messaged the business was
-- created by no user at all, and the alternatives were both worse than
-- relaxing the column: attributing the row to the workspace owner records a
-- person who did nothing, and that name is carried into the Excel and ZIP
-- exports, which go to customers. `source` already distinguishes the origin
-- and is where that question is answered honestly.
alter table public.customers alter column created_by drop not null;

-- ---------------------------------------------------------------------------
-- The message text has to survive ingestion.
-- ---------------------------------------------------------------------------
--
-- `text_summary` is what its name says: a 500-character preview, truncated at
-- ingest. `messages.body` permits 10000. Since the webhook request body is the
-- only place the full text ever exists, and the projection runs later from
-- durable state, anything past 500 characters was unrecoverable by the time
-- anyone wanted it. The preview stays for listing and search; `body` carries
-- the message.
alter table public.meta_webhook_events
  add column if not exists body text
  check (body is null or char_length(body) <= 10000);

-- ---------------------------------------------------------------------------
-- One open conversation per customer per channel.
-- ---------------------------------------------------------------------------
--
-- The projection reads for an open conversation and creates one if absent,
-- which is a race whenever two events for the same customer are processed
-- concurrently - and the relay is explicitly concurrent per workspace. Without
-- this the loser of the race silently creates a second conversation and the
-- customer's messages split across two threads. Partial, because closed
-- conversations are history and a customer may have many.
create unique index if not exists conversations_one_open_per_customer_channel
  on public.conversations (workspace_id, customer_id, channel)
  where state = 'open';

-- ---------------------------------------------------------------------------
-- What the turn engine committed.
-- ---------------------------------------------------------------------------
--
-- `runTurn` needs three facts that must outlive the process: whether this
-- event was already handled, which send refs a conversation has used, and what
-- the outcome was. All three are the same row. Recording every outcome, not
-- only the ones that sent, is the point: a turn nobody recorded is a turn
-- nobody can explain, and the refusals are the ones somebody asks about.
create table if not exists public.turn_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null,
  -- The provider event this turn answered. Unique per workspace: this column
  -- is what makes a redelivered webhook cost nothing.
  event_id text not null check (char_length(event_id) between 1 and 200),
  outcome text not null check (
    outcome in (
      'duplicate', 'policy_blocked', 'sent', 'handoff', 'safe_acknowledgement', 'tool_refused'
    )
  ),
  reason_codes text[] not null default '{}',
  accepted_memory_writes integer not null default 0 check (accepted_memory_writes >= 0),
  refused_memory_writes integer not null default 0 check (refused_memory_writes >= 0),
  tool_executed boolean not null default false,
  -- Null unless the turn reached the send step. Its presence is what
  -- `sentRefs` reports, so it must not be filled optimistically.
  send_ref text,
  created_at timestamptz not null default now(),
  unique (workspace_id, event_id),
  foreign key (conversation_id, workspace_id)
    references public.conversations(id, workspace_id) on delete cascade
);

create index if not exists turn_records_workspace_conversation
  on public.turn_records (workspace_id, conversation_id, created_at desc);

alter table public.turn_records enable row level security;
alter table public.turn_records force row level security;
revoke all on public.turn_records from anon, authenticated;
grant all on public.turn_records to service_role;
grant select on public.turn_records to authenticated;
create policy turn_records_select_member on public.turn_records
  for select to authenticated using (private.is_active_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Ingestion carries the full body through.
-- ---------------------------------------------------------------------------
--
-- Recreated rather than overloaded so there is exactly one ingest function and
-- no possibility of a caller reaching the old arity by accident. `p_body`
-- defaults to null so a caller that predates it still resolves; the projection
-- then falls back to the 500-character preview, which is a degraded message
-- rather than a lost one.
drop function if exists public.ingest_meta_event(
  text, text, text, text, text, text, text, jsonb, jsonb, timestamptz
);

create or replace function public.ingest_meta_event(
  p_channel text, p_provider_account_id text, p_provider_event_id text,
  p_event_type text, p_sender_ref text, p_provider_message_ref text,
  p_text_summary text, p_attachment_metadata jsonb, p_status_metadata jsonb,
  p_occurred_at timestamptz, p_body text default null
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

  insert into public.meta_webhook_events(workspace_id,connection_id,channel,provider_event_id,event_type,sender_ref,provider_message_ref,text_summary,body,attachment_metadata,status_metadata,occurred_at)
  values(c.workspace_id,c.id,p_channel,p_provider_event_id,p_event_type,p_sender_ref,p_provider_message_ref,left(p_text_summary,500),left(p_body,10000),coalesce(p_attachment_metadata,'[]'::jsonb),coalesce(p_status_metadata,'{}'::jsonb),p_occurred_at)
  on conflict(channel,provider_event_id) do nothing returning id into inserted_id;
  if inserted_id is null then return query select 'duplicate'::text,null::uuid,c.workspace_id; return; end if;

  insert into public.provider_event_outbox(workspace_id,webhook_event_id,payload)
  values(c.workspace_id,inserted_id,jsonb_build_object('webhookEventId',inserted_id,'trustedWorkspaceId',c.workspace_id,'channel',p_channel,'providerEventId',p_provider_event_id));
  return query select 'accepted'::text,inserted_id,c.workspace_id;
end; $$;

revoke all on function public.ingest_meta_event(
  text,text,text,text,text,text,text,jsonb,jsonb,timestamptz,text
) from public, anon, authenticated;
grant execute on function public.ingest_meta_event(
  text,text,text,text,text,text,text,jsonb,jsonb,timestamptz,text
) to service_role;

-- ---------------------------------------------------------------------------
-- The projection itself.
-- ---------------------------------------------------------------------------
--
-- Takes one verified webhook event and makes it visible: an identity, a
-- customer, an open conversation and a message. Idempotent at every step, so a
-- replayed relay, a retried Inngest step and a redelivered webhook all
-- converge on the same single row rather than on three.
--
-- security definer with an empty search_path, and executable only by
-- service_role, for the same reason as ingest_meta_event: it writes across
-- tenant tables and must never be reachable from a browser session, which
-- could otherwise name a workspace it does not belong to.
create or replace function public.project_meta_message(
  p_webhook_event_id uuid, p_workspace_id uuid
) returns table(result text, customer_id uuid, conversation_id uuid, message_id uuid)
language plpgsql security definer set search_path='' as $$
-- The OUT parameters are named for the columns they return, which is what the
-- caller reads, so inside the body those names are ambiguous with the columns
-- themselves. Resolving them to the column is the reading that is always meant
-- here: every value this function returns travels in a v_ local.
#variable_conflict use_column
declare
  e public.meta_webhook_events;
  v_customer_id uuid;
  v_claimed_customer_id uuid;
  v_conversation_id uuid;
  v_message_id uuid;
  v_display_name text;
  v_provider_message_id text;
  v_status public.message_status;
begin
  -- The workspace is a parameter rather than something this reads from the
  -- event, so a caller that has resolved the wrong tenant gets nothing back
  -- instead of writing into it.
  select * into e from public.meta_webhook_events
   where id = p_webhook_event_id and workspace_id = p_workspace_id;
  if e.id is null then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid; return;
  end if;

  -- A delivery receipt updates the message it refers to and creates nothing.
  -- 'delivered' and 'read' both mean it left; the distinction between them is
  -- not one the inbox draws, and inventing a status for it would be a column
  -- nobody reads.
  if e.event_type = 'message_status' then
    if e.provider_message_ref is null then
      return query select 'no_message_ref'::text, null::uuid, null::uuid, null::uuid; return;
    end if;
    v_status := case
      when e.status_metadata->>'status' = 'failed' then 'failed'::public.message_status
      else 'sent'::public.message_status
    end;
    update public.messages set status = v_status
     where workspace_id = p_workspace_id and provider_message_id = e.provider_message_ref
     returning id, customer_id, conversation_id
       into v_message_id, v_customer_id, v_conversation_id;
    return query select
      case when v_message_id is null then 'status_unmatched' else 'status_applied' end,
      v_customer_id, v_conversation_id, v_message_id;
    return;
  end if;

  -- Comments and private replies are recorded by ingestion and deliberately
  -- not projected: they are not a direct-message thread, and folding them into
  -- one would make a conversation mean two different things.
  if e.event_type <> 'message' then
    return query select 'skipped'::text, null::uuid, null::uuid, null::uuid; return;
  end if;

  if e.sender_ref is null or btrim(e.sender_ref) = '' then
    return query select 'no_sender'::text, null::uuid, null::uuid, null::uuid; return;
  end if;

  -- Identity first: it is the only stable key. The provider gives a phone
  -- number or an account id and no name, so the identifier stands in as the
  -- display name until a person renames the record. Inventing "WhatsApp
  -- customer" would be less useful and no less arbitrary.
  select cci.customer_id into v_customer_id
    from public.customer_channel_identities cci
   where cci.workspace_id = p_workspace_id
     and cci.channel = e.channel
     and cci.external_id = e.sender_ref;

  if v_customer_id is null then
    v_display_name := left(btrim(e.sender_ref), 120);
    insert into public.customers(workspace_id, display_name, source, created_by)
    values (p_workspace_id, v_display_name, 'inbound_' || e.channel, null)
    returning id into v_customer_id;

    insert into public.customer_channel_identities(workspace_id, customer_id, channel, external_id)
    values (p_workspace_id, v_customer_id, e.channel, e.sender_ref)
    on conflict (workspace_id, channel, external_id) do nothing;

    -- Losing the race is normal, not exceptional: two messages from the same
    -- new customer can be in flight at once. The identity row decides who the
    -- customer is, and the customer this call speculatively created is
    -- discarded rather than left behind as a duplicate contact.
    select cci.customer_id into v_claimed_customer_id
      from public.customer_channel_identities cci
     where cci.workspace_id = p_workspace_id
       and cci.channel = e.channel
       and cci.external_id = e.sender_ref;
    if v_claimed_customer_id is distinct from v_customer_id then
      delete from public.customers
       where id = v_customer_id and workspace_id = p_workspace_id;
      v_customer_id := v_claimed_customer_id;
    end if;
  end if;

  select c.id into v_conversation_id
    from public.conversations c
   where c.workspace_id = p_workspace_id
     and c.customer_id = v_customer_id
     and c.channel = e.channel
     and c.state = 'open';

  if v_conversation_id is null then
    insert into public.conversations(workspace_id, customer_id, channel, state, owner, last_message_at)
    values (p_workspace_id, v_customer_id, e.channel, 'open', 'automation', e.occurred_at)
    on conflict (workspace_id, customer_id, channel) where state = 'open' do nothing
    returning id into v_conversation_id;

    if v_conversation_id is null then
      select c.id into v_conversation_id
        from public.conversations c
       where c.workspace_id = p_workspace_id
         and c.customer_id = v_customer_id
         and c.channel = e.channel
         and c.state = 'open';
    end if;
  end if;

  -- A message with no provider id cannot be deduplicated by one, and a retried
  -- step would insert it again. The event id is unique and durable, so it
  -- stands in - it will never match a delivery receipt, which is correct,
  -- because there is no provider message for one to refer to.
  v_provider_message_id := coalesce(e.provider_message_ref, 'evt:' || e.id::text);

  insert into public.messages(
    workspace_id, conversation_id, customer_id, direction, status, body, provider_message_id, sent_at
  )
  values (
    p_workspace_id, v_conversation_id, v_customer_id, 'inbound', 'received',
    coalesce(e.body, e.text_summary, ''), v_provider_message_id, e.occurred_at
  )
  on conflict (workspace_id, provider_message_id) do nothing
  returning id into v_message_id;

  if v_message_id is null then
    return query select 'duplicate'::text, v_customer_id, v_conversation_id, null::uuid; return;
  end if;

  update public.conversations
     set last_message_at = greatest(coalesce(last_message_at, e.occurred_at), e.occurred_at),
         unread_count = unread_count + 1,
         updated_at = now()
   where id = v_conversation_id and workspace_id = p_workspace_id;

  return query select 'projected'::text, v_customer_id, v_conversation_id, v_message_id;
end; $$;

revoke all on function public.project_meta_message(uuid, uuid) from public, anon, authenticated;
grant execute on function public.project_meta_message(uuid, uuid) to service_role;
