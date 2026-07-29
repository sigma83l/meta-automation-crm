-- Prompt 8R: independently deployable production hardening.
-- External provider resources are deliberately not provisioned here.

alter type public.automation_recipe
  add value if not exists 'WHATSAPP_CONSENTED_FOLLOWUP_REMINDER';
alter type public.automation_recipe
  add value if not exists 'CROSS_CHANNEL_AFTER_HOURS_ESCALATION';

alter type public.membership_role add value if not exists 'admin';
alter type public.membership_role add value if not exists 'operator';
alter type public.membership_role add value if not exists 'viewer';

create table private.auth_rate_limits (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  attempts integer not null check (attempts > 0),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

revoke all on table private.auth_rate_limits from public, anon, authenticated;
grant all on table private.auth_rate_limits to service_role;

create or replace function public.consume_auth_rate_limit(
  requested_key_hash text,
  requested_maximum integer,
  requested_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_attempts integer;
begin
  if requested_key_hash !~ '^[a-f0-9]{64}$'
    or requested_maximum not between 1 and 100
    or requested_window_seconds not between 10 and 3600 then
    return false;
  end if;

  insert into private.auth_rate_limits(key_hash, attempts, expires_at, updated_at)
  values (
    requested_key_hash,
    1,
    clock_timestamp() + make_interval(secs => requested_window_seconds),
    clock_timestamp()
  )
  on conflict (key_hash) do update
  set
    attempts = case
      when private.auth_rate_limits.expires_at <= clock_timestamp() then 1
      else private.auth_rate_limits.attempts + 1
    end,
    expires_at = case
      when private.auth_rate_limits.expires_at <= clock_timestamp()
        then clock_timestamp() + make_interval(secs => requested_window_seconds)
      else private.auth_rate_limits.expires_at
    end,
    updated_at = clock_timestamp()
  returning attempts into current_attempts;

  return current_attempts <= requested_maximum;
end;
$$;

revoke all on function public.consume_auth_rate_limit(text, integer, integer)
  from public;
grant execute on function public.consume_auth_rate_limit(text, integer, integer)
  to anon, authenticated, service_role;

create index auth_rate_limits_expiry_idx
  on private.auth_rate_limits(expires_at);

create table public.crm_import_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  source_name text not null check (char_length(source_name) between 1 and 160),
  status text not null check (status in ('processing', 'completed', 'failed')),
  accepted_rows integer not null default 0 check (accepted_rows >= 0),
  rejected_rows integer not null default 0 check (rejected_rows >= 0),
  safe_error_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, id)
);

alter table public.crm_import_jobs enable row level security;
alter table public.crm_import_jobs force row level security;
revoke all on table public.crm_import_jobs from anon, authenticated;
grant select on table public.crm_import_jobs to authenticated;
grant all on table public.crm_import_jobs to service_role;
create policy crm_import_jobs_select_member
  on public.crm_import_jobs
  for select
  to authenticated
  using (private.is_active_member(workspace_id));

create or replace function public.import_crm_rows(
  trusted_workspace_id uuid,
  trusted_requested_by uuid,
  requested_source_name text,
  requested_rows jsonb
)
returns table (job_id uuid, job_status text, accepted_rows integer, rejected_rows integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_job_id uuid;
  requested_row jsonb;
  created_customer_id uuid;
  imported_count integer := 0;
begin
  if jsonb_typeof(requested_rows) <> 'array'
    or jsonb_array_length(requested_rows) not between 1 and 500
    or char_length(requested_source_name) not between 1 and 160
    or not exists (
      select 1 from public.workspace_memberships membership
      where membership.workspace_id = trusted_workspace_id
        and membership.user_id = trusted_requested_by
        and membership.status = 'active'
        and membership.role::text in ('owner', 'admin', 'operator')
    ) then
    raise exception 'invalid import request';
  end if;

  insert into public.crm_import_jobs(
    workspace_id, requested_by, source_name, status
  )
  values (
    trusted_workspace_id, trusted_requested_by, requested_source_name, 'processing'
  )
  returning id into created_job_id;

  begin
    for requested_row in select value from jsonb_array_elements(requested_rows)
    loop
      if char_length(btrim(coalesce(requested_row->>'displayName', ''))) not between 1 and 120
        or char_length(coalesce(requested_row->>'companyName', '')) > 120
        or char_length(coalesce(requested_row->>'email', '')) > 254
        or char_length(coalesce(requested_row->>'phone', '')) > 40 then
        raise exception 'invalid import row';
      end if;

      insert into public.customers(
        workspace_id, display_name, company_name, source, created_by
      )
      values (
        trusted_workspace_id,
        btrim(requested_row->>'displayName'),
        nullif(btrim(requested_row->>'companyName'), ''),
        'csv_import',
        trusted_requested_by
      )
      returning id into created_customer_id;

      if nullif(btrim(requested_row->>'email'), '') is not null then
        insert into public.customer_contact_methods(
          workspace_id, customer_id, kind, value, is_primary
        )
        values (
          trusted_workspace_id,
          created_customer_id,
          'email',
          btrim(requested_row->>'email'),
          true
        );
      end if;
      if nullif(btrim(requested_row->>'phone'), '') is not null then
        insert into public.customer_contact_methods(
          workspace_id, customer_id, kind, value, is_primary
        )
        values (
          trusted_workspace_id,
          created_customer_id,
          'phone',
          btrim(requested_row->>'phone'),
          nullif(btrim(requested_row->>'email'), '') is null
        );
      end if;

      insert into public.customer_activities(
        workspace_id, customer_id, activity_type, summary
      )
      values (
        trusted_workspace_id,
        created_customer_id,
        'customer.imported',
        'Customer imported from a validated CSV file'
      );

      insert into public.crm_audit_events(
        workspace_id, actor_user_id, customer_id, action, metadata
      )
      values (
        trusted_workspace_id,
        trusted_requested_by,
        created_customer_id,
        'crm.customer.imported',
        jsonb_build_object('import_job_id', created_job_id)
      );
      imported_count := imported_count + 1;
    end loop;
  exception when others then
    update public.crm_import_jobs
    set
      status = 'failed',
      rejected_rows = jsonb_array_length(requested_rows),
      safe_error_codes = array['IMPORT_ROW_INVALID'],
      completed_at = clock_timestamp()
    where id = created_job_id and workspace_id = trusted_workspace_id;
    return query select created_job_id, 'failed'::text, 0, jsonb_array_length(requested_rows);
    return;
  end;

  update public.crm_import_jobs
  set
    status = 'completed',
    accepted_rows = imported_count,
    completed_at = clock_timestamp()
  where id = created_job_id and workspace_id = trusted_workspace_id;
  return query select created_job_id, 'completed'::text, imported_count, 0;
end;
$$;

revoke all on function public.import_crm_rows(uuid, uuid, text, jsonb) from public;
grant execute on function public.import_crm_rows(uuid, uuid, text, jsonb) to service_role;

create or replace function private.can_manage_workspace(target_workspace_id uuid)
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
      and membership.status = 'active'
      and membership.role::text in ('owner', 'admin')
      and private.is_active_member(target_workspace_id)
  );
$$;

create or replace function private.can_operate_workspace(target_workspace_id uuid)
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
      and membership.status = 'active'
      and membership.role::text in ('owner', 'admin', 'operator')
      and private.is_active_member(target_workspace_id)
  );
$$;

create or replace function public.purge_expired_auth_rate_limits(requested_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  if requested_limit not between 1 and 10000 then
    raise exception 'invalid cleanup limit';
  end if;
  with expired as (
    select key_hash
    from private.auth_rate_limits
    where expires_at <= clock_timestamp()
    order by expires_at
    limit requested_limit
    for update skip locked
  )
  delete from private.auth_rate_limits limits
  using expired
  where limits.key_hash = expired.key_hash;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_expired_auth_rate_limits(integer) from public;
grant execute on function public.purge_expired_auth_rate_limits(integer) to service_role;

-- Replace broad active-member mutation policies with role-aware policies.
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
    execute format('drop policy if exists %I on public.%I', table_name || '_insert_member', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_update_member', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_delete_member', table_name);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (private.can_operate_workspace(workspace_id))',
      table_name || '_insert_operator', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (private.can_operate_workspace(workspace_id)) with check (private.can_operate_workspace(workspace_id))',
      table_name || '_update_operator', table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (private.can_operate_workspace(workspace_id))',
      table_name || '_delete_operator', table_name
    );
  end loop;

  foreach table_name in array array[
    'business_profiles', 'business_faq_items', 'business_price_items'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_insert_member', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_update_member', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_delete_member', table_name);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (private.can_manage_workspace(workspace_id))',
      table_name || '_insert_manager', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (private.can_manage_workspace(workspace_id)) with check (private.can_manage_workspace(workspace_id))',
      table_name || '_update_manager', table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (private.can_manage_workspace(workspace_id))',
      table_name || '_delete_manager', table_name
    );
  end loop;
end;
$$;

drop policy if exists workspace_settings_update_owner on public.workspace_settings;
create policy workspace_settings_update_manager
  on public.workspace_settings
  for update
  to authenticated
  using (private.can_manage_workspace(workspace_id))
  with check (private.can_manage_workspace(workspace_id));

drop policy if exists crm_private_insert_member on storage.objects;
drop policy if exists crm_private_update_member on storage.objects;
drop policy if exists crm_private_delete_member on storage.objects;
drop policy if exists customer_media_insert_member on storage.objects;
drop policy if exists customer_media_update_member on storage.objects;
drop policy if exists customer_media_delete_member on storage.objects;
drop policy if exists crm_exports_insert_member on storage.objects;
drop policy if exists crm_exports_update_member on storage.objects;
drop policy if exists crm_exports_delete_member on storage.objects;

create policy private_objects_insert_operator on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('crm-private', 'customer-media', 'crm-exports')
    and private.can_operate_workspace(private.try_uuid((storage.foldername(name))[1]))
  );
create policy private_objects_update_operator on storage.objects
  for update to authenticated
  using (
    bucket_id in ('crm-private', 'customer-media', 'crm-exports')
    and private.can_operate_workspace(private.try_uuid((storage.foldername(name))[1]))
  )
  with check (
    bucket_id in ('crm-private', 'customer-media', 'crm-exports')
    and private.can_operate_workspace(private.try_uuid((storage.foldername(name))[1]))
  );
create policy private_objects_delete_operator on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('crm-private', 'customer-media', 'crm-exports')
    and private.can_operate_workspace(private.try_uuid((storage.foldername(name))[1]))
  );

-- Onboarding is one state per business workspace. Additional members inherit
-- that workspace state instead of requiring an impossible second primary row.
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
  left join public.onboarding_states onboarding
    on onboarding.workspace_id = membership.workspace_id
  where membership.user_id = (select auth.uid())
    and membership.status = 'active'
    and workspace.status = 'active'
    and profile.status = 'active'
    and (workspace_hint is null or workspace_hint = workspace.id)
  limit 1;
$$;
