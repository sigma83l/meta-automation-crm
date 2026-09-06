-- Platform administration console.
--
-- Every other table in this schema is workspace scoped, and that is the
-- repository's central rule: a browser-supplied workspace is a hint, the server
-- resolves the real one, and RLS agrees with the server. This migration is the
-- one deliberate exception to that rule, so it is worth being explicit about
-- what changes and what does not.
--
-- What changes: a small set of people - Rellooma staff, recorded in
-- `platform_admins` - can read across workspaces and can act on them. That is a
-- genuine cross-tenant capability and there is no way to build a support
-- console without one.
--
-- What does not change: the capability is not ambient. It is granted per user
-- row, checked by a single security-definer predicate, carries a role that
-- distinguishes looking from acting, and every action it authorises is written
-- to an append-only ledger that not even service_role may edit. Membership
-- roles are untouched: a platform admin has no workspace membership and gains
-- none, so the workspace-scoped policies keep discriminating exactly as they
-- did.
--
-- Four things live here:
--
--   platform_admins          who the staff are, and what they may do
--   feature flags            a catalogue, per-plan defaults, per-workspace
--                            overrides, and one resolution function
--   platform_switches        deny-biased global kill switches
--   impersonation grants     time-boxed, reasoned, read-only "view as"
--
-- The audit ledger sits under all four.

-- ---------------------------------------------------------------------------
-- Staff identity
-- ---------------------------------------------------------------------------

-- Three roles, because "can read every workspace" and "can suspend a customer"
-- are different powers and collapsing them would mean every support hire holds
-- the destructive one.
--
--   platform_support  read the console; open an impersonation grant
--   platform_admin    the above, plus suspend/restore, plan overrides,
--                     feature flags, ops actions
--   platform_owner    the above, plus granting and revoking staff access
create type public.platform_admin_role as enum (
  'platform_support',
  'platform_admin',
  'platform_owner'
);

create type public.platform_admin_status as enum ('active', 'disabled');

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.platform_admin_role not null default 'platform_support',
  status public.platform_admin_status not null default 'active',
  -- Nullable only because the very first admin is granted by a server-side
  -- script with no signed-in actor to attribute it to. Every later grant is
  -- attributed, and the console refuses to write one without an actor.
  granted_by uuid references auth.users(id) on delete set null,
  granted_reason text not null
    check (char_length(btrim(granted_reason)) between 3 and 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index platform_admins_active_idx
  on public.platform_admins(status, role);

-- ---------------------------------------------------------------------------
-- The append-only ledger
-- ---------------------------------------------------------------------------

-- Cross-tenant power is only accountable if the record of its use cannot be
-- edited by the same credential that holds the power. service_role can insert
-- here and nothing more; the trigger below makes that true at the engine rather
-- than by convention.
create table public.platform_admin_audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  actor_role public.platform_admin_role not null,
  action text not null check (action ~ '^[a-z][a-z0-9_.]{2,60}$'),
  target_workspace_id uuid references public.workspaces(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  -- Non-secret, non-PII context only: state transitions, flag keys, plan keys,
  -- reasons typed by staff. Never a token, credential, message body or contact
  -- detail. `safe_` names the obligation in the column, as the automation and
  -- CRM audit tables already do.
  safe_details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(safe_details) = 'object'),
  occurred_at timestamptz not null default now()
);

create index platform_admin_audit_recent_idx
  on public.platform_admin_audit_events(occurred_at desc);
create index platform_admin_audit_actor_idx
  on public.platform_admin_audit_events(actor_id, occurred_at desc);
create index platform_admin_audit_workspace_idx
  on public.platform_admin_audit_events(target_workspace_id, occurred_at desc);

create or replace function private.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'platform_admin_audit_events is append-only';
end;
$$;

create trigger platform_admin_audit_no_update
  before update or delete on public.platform_admin_audit_events
  for each row execute function private.reject_audit_mutation();

-- ---------------------------------------------------------------------------
-- Feature flags
-- ---------------------------------------------------------------------------

-- Three layers, resolved in one place. A plan says what a tier includes, an
-- override says what this one customer gets regardless, and the catalogue entry
-- is the backstop and the kill switch. Without the override layer "turn this on
-- for one customer" means inventing a bespoke plan, which is how plan
-- catalogues rot.
create table public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{2,60}$'),
  display_name text not null
    check (char_length(btrim(display_name)) between 2 and 120),
  description text not null
    check (char_length(btrim(description)) between 2 and 400),
  default_enabled boolean not null default false,
  -- Archived wins over everything below it. Retiring a capability should not
  -- require finding and deleting every override that mentions it.
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plan_feature_defaults (
  plan_id uuid not null references public.subscription_plans(id) on delete cascade,
  flag_key text not null references public.feature_flags(key) on delete cascade,
  enabled boolean not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (plan_id, flag_key)
);

create table public.workspace_feature_overrides (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  flag_key text not null references public.feature_flags(key) on delete cascade,
  enabled boolean not null,
  -- Required. An override with no stated reason is indistinguishable from a
  -- mistake six months later, and this table is exactly where mistakes
  -- accumulate silently.
  reason text not null check (char_length(btrim(reason)) between 3 and 400),
  set_by uuid references auth.users(id) on delete set null,
  -- Optional deadline for trials and pilots. An expired override stops applying
  -- without anyone having to remember to remove it.
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, flag_key)
);

create index workspace_feature_overrides_flag_idx
  on public.workspace_feature_overrides(flag_key, workspace_id);
create index workspace_feature_overrides_expiry_idx
  on public.workspace_feature_overrides(expires_at)
  where expires_at is not null;

-- One definition of "is this on for this workspace", used by the console, by
-- the application gate, and by the tests. Anything that re-implements the
-- precedence in application code will eventually disagree with the console
-- screen that shows the answer, which is the failure this exists to prevent.
create or replace function public.workspace_feature_enabled(
  target_workspace_id uuid,
  target_flag_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (
      select 1 from public.feature_flags f
      where f.key = target_flag_key and not f.archived
    ) then false
    else coalesce(
      (
        select o.enabled
        from public.workspace_feature_overrides o
        where o.workspace_id = target_workspace_id
          and o.flag_key = target_flag_key
          and (o.expires_at is null or o.expires_at > now())
      ),
      (
        select d.enabled
        from public.plan_feature_defaults d
        join public.workspace_subscriptions s on s.plan_id = d.plan_id
        where s.workspace_id = target_workspace_id
          and d.flag_key = target_flag_key
      ),
      (
        select f.default_enabled
        from public.feature_flags f
        where f.key = target_flag_key
      )
    )
  end;
$$;

-- The bulk read. A page that gates six sections should ask once, not six times.
create or replace function public.workspace_feature_flags(target_workspace_id uuid)
returns table (flag_key text, enabled boolean, source text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    f.key,
    public.workspace_feature_enabled(target_workspace_id, f.key),
    case
      when exists (
        select 1 from public.workspace_feature_overrides o
        where o.workspace_id = target_workspace_id
          and o.flag_key = f.key
          and (o.expires_at is null or o.expires_at > now())
      ) then 'override'
      when exists (
        select 1 from public.plan_feature_defaults d
        join public.workspace_subscriptions s on s.plan_id = d.plan_id
        where s.workspace_id = target_workspace_id and d.flag_key = f.key
      ) then 'plan'
      else 'default'
    end
  from public.feature_flags f
  where not f.archived
  order by f.key;
$$;

-- ---------------------------------------------------------------------------
-- Global switches
-- ---------------------------------------------------------------------------

-- Deny-biased, and that asymmetry is the whole design. A switch set false
-- forces the capability off everywhere immediately. A switch set true asserts
-- nothing: the environment gate, the approval, the allowlist and the provider
-- policy all still have to agree. So this table can stop a live send and can
-- never start one, which keeps `AGENTS.md`'s default-deny intact while still
-- giving an operator a single lever during an incident.
create table public.platform_switches (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{2,60}$'),
  enabled boolean not null,
  description text not null
    check (char_length(btrim(description)) between 2 and 400),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.platform_switches (key, enabled, description) values
  ('public_signup', true,
   'Allow new self-service signups. Off forces invite-only regardless of AUTH_SIGNUP_MODE.'),
  ('live_provider_send', true,
   'Permit outbound provider sends. Off blocks all sends; on defers to the environment gate.'),
  ('ai_replies', true,
   'Permit AI reply generation. Off stops drafting for every workspace.'),
  ('crm_imports', true,
   'Permit CRM import jobs. Off rejects new import submissions.'),
  ('billing_charges', true,
   'Permit charge attempts. Off pauses the charge cron without touching provider state.');

-- ---------------------------------------------------------------------------
-- Trial extension
-- ---------------------------------------------------------------------------

-- "Give them another week" is the commonest billing support request there is,
-- and `transition_workspace_subscription` cannot serve it: moving to 'trialing'
-- from 'trialing' is an illegal transition, and `trial_consumed_at` is already
-- set, so it would raise twice over. Those refusals are correct - they are what
-- stops a workspace cycling cards for endless free trials - so this does not
-- relax them.
--
-- Instead it moves the one field a support extension actually needs and leaves
-- every anti-abuse invariant standing: `trial_consumed_at` is never cleared,
-- the status is never re-granted, and the deadline can only move forward. A
-- workspace still gets one trial ever; staff can only change when that one
-- trial ends.
create or replace function public.platform_extend_trial(
  trusted_workspace_id uuid,
  trusted_new_ends_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
  current_ends_at timestamptz;
  affected_rows integer;
begin
  select status, coalesce(trial_ends_at, grace_ends_at)
    into current_status, current_ends_at
  from public.workspace_subscriptions
  where workspace_id = trusted_workspace_id
  for update;

  if current_status is null then
    return false;
  end if;

  -- Only a workspace actually inside a trial or its grace window. Extending
  -- anything else would be inventing a trial rather than lengthening one.
  if current_status not in ('trialing', 'trial_expired_grace') then
    raise exception 'trial extension requires a trialing workspace, not %', current_status;
  end if;

  if trusted_new_ends_at <= coalesce(current_ends_at, now()) then
    raise exception 'a trial extension must move the deadline forward';
  end if;

  if trusted_new_ends_at > now() + interval '90 days' then
    raise exception 'a trial extension may not exceed 90 days from now';
  end if;

  update public.workspace_subscriptions
  set
    status = 'trialing',
    trial_ends_at = trusted_new_ends_at,
    grace_ends_at = null,
    updated_at = now()
  where workspace_id = trusted_workspace_id;
  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

revoke all on function public.platform_extend_trial(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.platform_extend_trial(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Impersonation
-- ---------------------------------------------------------------------------

-- A grant records intent and bounds it. It does not mint a session, does not
-- change who auth.uid() is, and nothing in the write paths consults it - the
-- console reads a workspace through service_role while a live grant exists and
-- shows it behind a banner. That is why "read-only" is a structural claim here
-- rather than a promise: there is no code path from a grant to a write.
create table public.platform_impersonation_grants (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 8 and 400),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index platform_impersonation_admin_idx
  on public.platform_impersonation_grants(admin_id, expires_at desc);
create index platform_impersonation_workspace_idx
  on public.platform_impersonation_grants(workspace_id, expires_at desc);

-- ---------------------------------------------------------------------------
-- The staff predicate
-- ---------------------------------------------------------------------------

-- Security definer so the policies below can consult platform_admins without
-- the caller holding a policy on it, which would otherwise recurse: the table
-- that decides who may read the table.
create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins staff
    where staff.user_id = (select auth.uid())
      and staff.status = 'active'
  );
$$;

-- Ranked, so a policy can ask for "admin or above" without enumerating.
create or replace function private.platform_admin_rank()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select case staff.role
        when 'platform_owner' then 3
        when 'platform_admin' then 2
        when 'platform_support' then 1
      end
      from public.platform_admins staff
      where staff.user_id = (select auth.uid())
        and staff.status = 'active'
    ),
    0
  );
$$;

-- How the server learns who it is talking to. Returns no row for everybody
-- else, which is the answer the console treats as "not staff".
create or replace function public.current_platform_admin()
returns table (admin_user_id uuid, admin_role text, admin_status text)
language sql
stable
security definer
set search_path = ''
as $$
  select staff.user_id, staff.role::text, staff.status::text
  from public.platform_admins staff
  where staff.user_id = (select auth.uid())
    and staff.status = 'active';
$$;

-- ---------------------------------------------------------------------------
-- Privileges and row security
-- ---------------------------------------------------------------------------

alter table public.platform_admins enable row level security;
alter table public.platform_admin_audit_events enable row level security;
alter table public.feature_flags enable row level security;
alter table public.plan_feature_defaults enable row level security;
alter table public.workspace_feature_overrides enable row level security;
alter table public.platform_switches enable row level security;
alter table public.platform_impersonation_grants enable row level security;

alter table public.platform_admins force row level security;
alter table public.platform_admin_audit_events force row level security;
alter table public.feature_flags force row level security;
alter table public.plan_feature_defaults force row level security;
alter table public.workspace_feature_overrides force row level security;
alter table public.platform_switches force row level security;
alter table public.platform_impersonation_grants force row level security;

revoke all on table public.platform_admins from anon, authenticated;
revoke all on table public.platform_admin_audit_events from anon, authenticated;
revoke all on table public.feature_flags from anon, authenticated;
revoke all on table public.plan_feature_defaults from anon, authenticated;
revoke all on table public.workspace_feature_overrides from anon, authenticated;
revoke all on table public.platform_switches from anon, authenticated;
revoke all on table public.platform_impersonation_grants from anon, authenticated;

-- Reads only for authenticated sessions. Every write in this migration's
-- surface goes through service_role behind an explicit staff-role assertion in
-- the server module, matching how billing and webhook writes already work.
grant select on table public.platform_admins to authenticated;
grant select on table public.platform_admin_audit_events to authenticated;
grant select on table public.feature_flags to authenticated;
grant select on table public.plan_feature_defaults to authenticated;
grant select on table public.workspace_feature_overrides to authenticated;
grant select on table public.platform_switches to authenticated;
grant select on table public.platform_impersonation_grants to authenticated;

grant all on table
  public.platform_admins,
  public.feature_flags,
  public.plan_feature_defaults,
  public.workspace_feature_overrides,
  public.platform_switches,
  public.platform_impersonation_grants
to service_role;

-- Insert and select only: the append-only rule is a grant, and the trigger
-- above is the belt to that braces.
grant select, insert on table public.platform_admin_audit_events to service_role;

create policy platform_admins_select_staff on public.platform_admins
  for select to authenticated using (private.is_platform_admin());

create policy platform_admin_audit_select_staff on public.platform_admin_audit_events
  for select to authenticated using (private.is_platform_admin());

-- The catalogue is not sensitive and the application reads it to decide what to
-- render, so every signed-in session may see which capabilities exist. What a
-- given workspace actually gets is the override table, which is not open.
create policy feature_flags_select_authenticated on public.feature_flags
  for select to authenticated using (true);

create policy plan_feature_defaults_select_authenticated on public.plan_feature_defaults
  for select to authenticated using (true);

-- A member may see their own workspace's overrides - it is the honest answer to
-- "why can I not use this?" - and staff may see all of them.
create policy workspace_feature_overrides_select_member
  on public.workspace_feature_overrides
  for select to authenticated
  using (private.is_active_member(workspace_id) or private.is_platform_admin());

create policy platform_switches_select_authenticated on public.platform_switches
  for select to authenticated using (true);

create policy platform_impersonation_select_staff
  on public.platform_impersonation_grants
  for select to authenticated using (private.is_platform_admin());

grant execute on function public.current_platform_admin() to authenticated, service_role;
grant execute on function public.workspace_feature_enabled(uuid, text)
  to authenticated, service_role;
grant execute on function public.workspace_feature_flags(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Cross-workspace reads for staff
-- ---------------------------------------------------------------------------

-- Only the four tables the directory screens read. The rest of the console
-- reads through service_role behind an explicit assertion, deliberately: adding
-- `or private.is_platform_admin()` to fifty workspace-scoped policies would
-- make the staff predicate part of the tenant isolation guarantee everywhere,
-- and a single mistake in it would then be a cross-tenant leak in every table
-- at once. Four is a blast radius somebody can hold in their head.
create policy workspaces_select_platform_admin on public.workspaces
  for select to authenticated using (private.is_platform_admin());

create policy profiles_select_platform_admin on public.profiles
  for select to authenticated using (private.is_platform_admin());

create policy memberships_select_platform_admin on public.workspace_memberships
  for select to authenticated using (private.is_platform_admin());

create policy workspace_subscriptions_select_platform_admin
  on public.workspace_subscriptions
  for select to authenticated using (private.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Seed catalogue
-- ---------------------------------------------------------------------------

-- The capabilities the application already has and might reasonably be sold,
-- withheld or piloted per customer. Defaults match today's behaviour so
-- introducing the gate changes nothing until somebody moves a switch.
insert into public.feature_flags (key, display_name, description, default_enabled) values
  ('crm_import', 'CRM import', 'Bulk import of contacts from spreadsheet files.', true),
  ('crm_export', 'CRM export', 'Export contacts, media and history as an archive.', true),
  ('ai_replies', 'AI replies', 'Assistant-drafted replies in the inbox.', true),
  ('ai_proposals', 'AI proposals', 'Assistant-proposed CRM record changes for human approval.', true),
  ('automations', 'Automations', 'Automation recipes, versions and runs.', true),
  ('analytics', 'Analytics', 'Operational analytics from recorded workspace events.', true),
  ('instagram_channel', 'Instagram channel', 'Instagram connection and publishing.', true),
  ('whatsapp_channel', 'WhatsApp channel', 'WhatsApp connection and messaging.', true),
  ('saved_views', 'Saved views', 'Saved CRM filters shared across the workspace.', true),
  ('custom_fields', 'Custom fields', 'Workspace-defined contact fields.', true);
