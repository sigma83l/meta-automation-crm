-- Prompt 7: one-time OAuth state consumption for replay-resistant Meta callbacks.
create table public.meta_oauth_nonces (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','instagram')),
  state_hash text not null check (state_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, channel)
);

alter table public.meta_oauth_nonces enable row level security;
alter table public.meta_oauth_nonces force row level security;
revoke all on public.meta_oauth_nonces from anon, authenticated;
grant all on public.meta_oauth_nonces to service_role;

create or replace function public.consume_meta_oauth_nonce(
  p_workspace_id uuid,
  p_channel text,
  p_state_hash text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
begin
  update public.meta_oauth_nonces
  set consumed_at = now()
  where workspace_id = p_workspace_id
    and channel = p_channel
    and state_hash = p_state_hash
    and consumed_at is null
    and created_at <= now()
    and expires_at >= now();
  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

revoke all on function public.consume_meta_oauth_nonce(uuid,text,text) from public, anon, authenticated;
grant execute on function public.consume_meta_oauth_nonce(uuid,text,text) to service_role;

comment on table public.meta_oauth_nonces is
  'Server-only SHA-256 hashes of short-lived Meta OAuth state values; consumed exactly once.';
