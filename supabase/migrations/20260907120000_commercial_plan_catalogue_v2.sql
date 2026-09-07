-- The 2026-09-v2 commercial plan catalogue.
--
-- Replaces the single seeded plan ('standard_monthly', 499.00 TRY) with the
-- five-tier structure the V1.8 master pack freezes: Free, Solo, Growth,
-- Business, Agency, each on a monthly and an annual interval, priced in USD.
--
-- Source of truth: pricing_entitlements_2026-09-v2.json in the
-- Rellooma_V1_8_Economics_AI_Routing_Commercial_Launch_Master_Pack. Its version
-- string is stored on every row as `plan_version`, so a catalogue in a database
-- can be traced back to the document that specified it rather than being a set
-- of numbers nobody can source.
--
-- ## What this migration does not do
--
-- It changes the catalogue, not the billing engine. The pack also specifies
-- usage metering, a prepaid wallet, overage, auto-top-up and Paddle as the
-- provider; none of those exist here, and this file does not pretend otherwise.
-- The entitlement columns below are recorded limits, not enforced ones: nothing
-- yet counts monthly active contacts or AI work units, so writing 2500 into
-- `mac` states an intention rather than imposing a ceiling. Enforcement has to
-- arrive with the meters, and shipping the numbers first at least means the
-- meters have somewhere to read their limits from.
--
-- The provider is still PayTR. The pack names Paddle. Switching providers is a
-- commercial and legal decision, not a pricing edit, so it is deliberately out
-- of scope here.

begin;

-- Free has to be storable. The original constraint was written when exactly one
-- paid plan existed and zero was therefore meaningless; a catalogue with a free
-- tier makes it wrong.
alter table public.subscription_plans
  drop constraint if exists subscription_plans_price_minor_units_check;
alter table public.subscription_plans
  add constraint subscription_plans_price_minor_units_check
  check (price_minor_units >= 0);

-- Annual is half the published catalogue, so the interval check has to admit it.
alter table public.subscription_plans
  drop constraint if exists subscription_plans_billing_interval_check;
alter table public.subscription_plans
  add constraint subscription_plans_billing_interval_check
  check (billing_interval in ('monthly', 'annual'));

alter table public.subscription_plans
  -- Which tier this row belongs to, independent of interval: 'solo_monthly' and
  -- 'solo_annual' are two rows and one product, and every entitlement question
  -- is about the tier rather than the billing period.
  add column if not exists tier text
    check (tier is null or tier in ('free', 'solo', 'growth', 'business', 'agency')),
  add column if not exists plan_version text,
  add column if not exists positioning text,
  -- Ordering for any surface that lists plans, so presentation does not depend
  -- on price sorting, which breaks the moment an annual row is in the list.
  add column if not exists sort_order integer not null default 0,
  -- Agency is REQUEST_ACCESS_UNTIL_MULTI_TENANT_SECURITY_GATES_PASS in the
  -- pack. A row that exists but may not be self-served needs to say so here,
  -- because the alternative is remembering it somewhere else.
  add column if not exists publicly_selectable boolean not null default true,
  add column if not exists seats integer,
  add column if not exists workspaces integer,
  add column if not exists live_connections integer,
  add column if not exists managed_connections integer,
  -- Monthly active contacts. The pack's primary value meter.
  add column if not exists mac integer,
  add column if not exists crm_contacts integer,
  add column if not exists ai_work_units integer,
  add column if not exists automation_actions integer,
  add column if not exists connector_units integer,
  -- Null means fair-use rather than unlimited: the pack writes "FUP" for
  -- Business and Agency, and a number would be a promise nobody made.
  add column if not exists active_workflows integer,
  add column if not exists storage_mb integer,
  add column if not exists conversation_body_retention_days integer,
  add column if not exists knowledge_items integer,
  add column if not exists template_access text,
  add column if not exists broadcast text,
  add column if not exists api_access text,
  add column if not exists voice text,
  add column if not exists support text,
  add column if not exists byo_ai boolean not null default false,
  add column if not exists agency boolean not null default false,
  add column if not exists advanced_routing boolean not null default false,
  add column if not exists advanced_analytics boolean not null default false;

-- Retired, not deleted. `workspace_subscriptions.plan_id` is `on delete
-- restrict` and at least one live workspace points at this row; deleting it
-- would either fail or, worse, be made to succeed by first detaching a paying
-- workspace from its plan.
update public.subscription_plans
set active = false
where plan_key = 'standard_monthly';

insert into public.subscription_plans (
  plan_key, display_name, price_minor_units, currency, billing_interval, active,
  tier, plan_version, positioning, sort_order, publicly_selectable,
  seats, workspaces, live_connections, managed_connections,
  mac, crm_contacts, ai_work_units, automation_actions, connector_units,
  active_workflows, storage_mb, conversation_body_retention_days, knowledge_items,
  template_access, broadcast, api_access, voice, support,
  byo_ai, agency, advanced_routing, advanced_analytics
)
values
  ('free_monthly', 'Free', 0, 'USD', 'monthly', true,
   'free', '2026-09-v2', 'Aha Moment / evaluation', 10, true,
   1, 1, 1, 1,
   50, 250, 100, 250, 100,
   3, 250, 30, 25,
   '10_CORE_ENABLED_ALL_60_PREVIEW', 'test_or_transactional_only', 'none', 'demo_only_no_pstn', 'self_serve',
   false, false, false, false),

  ('solo_monthly', 'Solo', 1200, 'USD', 'monthly', true,
   'solo', '2026-09-v2', 'Creator / solo operator', 20, true,
   1, 1, 2, 3,
   500, 2000, 500, 3000, 1000,
   10, 2048, 90, 100,
   'CORE_PLUS_SELECTED_VERTICAL', 'limited_with_consent_and_provider_rules', 'none', 'studio_demo_only', 'email',
   false, false, false, false),

  ('solo_annual', 'Solo (annual)', 12000, 'USD', 'annual', true,
   'solo', '2026-09-v2', 'Creator / solo operator', 21, true,
   1, 1, 2, 3,
   500, 2000, 500, 3000, 1000,
   10, 2048, 90, 100,
   'CORE_PLUS_SELECTED_VERTICAL', 'limited_with_consent_and_provider_rules', 'none', 'studio_demo_only', 'email',
   false, false, false, false),

  ('growth_monthly', 'Growth', 4500, 'USD', 'monthly', true,
   'growth', '2026-09-v2', 'Startup / SMB operating system', 30, true,
   3, 1, 4, 10,
   2500, 10000, 3000, 15000, 5000,
   25, 10240, 180, 500,
   'ALL_60_GOLDEN', 'enabled_with_compliance_gate', 'limited_beta', 'controlled_byo_test', 'priority_email',
   true, false, false, false),

  ('growth_annual', 'Growth (annual)', 45000, 'USD', 'annual', true,
   'growth', '2026-09-v2', 'Startup / SMB operating system', 31, true,
   3, 1, 4, 10,
   2500, 10000, 3000, 15000, 5000,
   25, 10240, 180, 500,
   'ALL_60_GOLDEN', 'enabled_with_compliance_gate', 'limited_beta', 'controlled_byo_test', 'priority_email',
   true, false, false, false),

  ('business_monthly', 'Business', 10000, 'USD', 'monthly', true,
   'business', '2026-09-v2', 'Team operations + advanced control', 40, true,
   5, 1, 10, 25,
   7500, 50000, 8000, 40000, 10000,
   null, 51200, 365, 2500,
   'ALL_60_PLUS_EXPANSION_BETA', 'enabled_with_compliance_gate', 'full', 'byo_addon', 'priority',
   true, false, true, true),

  ('business_annual', 'Business (annual)', 100000, 'USD', 'annual', true,
   'business', '2026-09-v2', 'Team operations + advanced control', 41, true,
   5, 1, 10, 25,
   7500, 50000, 8000, 40000, 10000,
   null, 51200, 365, 2500,
   'ALL_60_PLUS_EXPANSION_BETA', 'enabled_with_compliance_gate', 'full', 'byo_addon', 'priority',
   true, false, true, true),

  -- Not publicly selectable: the pack gates Agency behind multi-tenant security
  -- review, and the row exists so staff can assign it, not so it can be bought.
  ('agency_monthly', 'Agency', 19000, 'USD', 'monthly', true,
   'agency', '2026-09-v2', 'Multi-client operating system', 50, false,
   10, 3, 25, 100,
   20000, 200000, 15000, 70000, 15000,
   null, 102400, 365, 7500,
   'ALL_PLUS_CLONING_AND_CLIENT_SCOPES', 'enabled_per_client_compliance', 'full_client_scopes', 'byo_addon_per_workspace', 'priority_agency',
   true, true, true, true),

  ('agency_annual', 'Agency (annual)', 190000, 'USD', 'annual', true,
   'agency', '2026-09-v2', 'Multi-client operating system', 51, false,
   10, 3, 25, 100,
   20000, 200000, 15000, 70000, 15000,
   null, 102400, 365, 7500,
   'ALL_PLUS_CLONING_AND_CLIENT_SCOPES', 'enabled_per_client_compliance', 'full_client_scopes', 'byo_addon_per_workspace', 'priority_agency',
   true, true, true, true)
on conflict (plan_key) do nothing;

-- Free has no annual row on purpose: zero billed yearly is the same product,
-- and a second row would only be somewhere for the two to disagree.

-- Repoint new-workspace provisioning at the new trial plan.
--
-- This is not optional tidying. `initialize_workspace_subscription` selected
-- `plan_key = 'standard_monthly' and active`, and retiring that row above makes
-- the lookup return NULL. `workspace_subscriptions.plan_id` is nullable, so the
-- insert would keep succeeding and every account created after this migration
-- would get a subscription attached to no plan at all — visible to nobody until
-- a customer opened their billing page and found it blank.
--
-- Growth is the pack's `default_trial_plan`. The seven-day length and the
-- trial_consumed_at stamp are carried over unchanged; only the plan moves.
create or replace function private.initialize_workspace_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_plan_id uuid;
  trial_length interval := interval '7 days';
begin
  select id into default_plan_id
  from public.subscription_plans
  where plan_key = 'growth_monthly' and active
  limit 1;

  -- trial_consumed_at is stamped here, at the moment the trial is granted.
  -- It is never cleared, so a workspace that cancels cannot come back around
  -- for a second free window - which is the same reason the column exists.
  insert into public.workspace_subscriptions (
    workspace_id, plan_id, status, trial_ends_at, trial_consumed_at
  )
  values (
    new.id, default_plan_id, 'trialing', now() + trial_length, now()
  )
  on conflict (workspace_id) do nothing;

  return new;
end;
$$;

-- Per-plan feature defaults.
--
-- The pack describes entitlements in its own vocabulary (broadcast, template
-- access, API tiers) and this table keys on the ten capability flags the
-- application actually gates on, so this mapping is a reading of the pack
-- rather than a transcription of it. Two rules it follows:
--
--   * Export and import stay on at every tier, including Free. The billing
--     document is explicit that manual inbox access and data export "must not
--     be hostage to usage exhaustion", and a customer who cannot get their data
--     out of the free tier has been locked in rather than given a trial.
--   * Anything the pack marks as gated, beta or absent at a tier is off here.
insert into public.plan_feature_defaults (plan_id, flag_key, enabled)
select p.id, f.flag_key, f.enabled
from public.subscription_plans p
join (
  values
    ('free', 'crm_import', true), ('free', 'crm_export', true),
    ('free', 'ai_replies', true), ('free', 'ai_proposals', false),
    ('free', 'automations', true), ('free', 'analytics', false),
    ('free', 'instagram_channel', true), ('free', 'whatsapp_channel', true),
    ('free', 'saved_views', false), ('free', 'custom_fields', false),

    ('solo', 'crm_import', true), ('solo', 'crm_export', true),
    ('solo', 'ai_replies', true), ('solo', 'ai_proposals', false),
    ('solo', 'automations', true), ('solo', 'analytics', true),
    ('solo', 'instagram_channel', true), ('solo', 'whatsapp_channel', true),
    ('solo', 'saved_views', true), ('solo', 'custom_fields', false),

    ('growth', 'crm_import', true), ('growth', 'crm_export', true),
    ('growth', 'ai_replies', true), ('growth', 'ai_proposals', true),
    ('growth', 'automations', true), ('growth', 'analytics', true),
    ('growth', 'instagram_channel', true), ('growth', 'whatsapp_channel', true),
    ('growth', 'saved_views', true), ('growth', 'custom_fields', true),

    ('business', 'crm_import', true), ('business', 'crm_export', true),
    ('business', 'ai_replies', true), ('business', 'ai_proposals', true),
    ('business', 'automations', true), ('business', 'analytics', true),
    ('business', 'instagram_channel', true), ('business', 'whatsapp_channel', true),
    ('business', 'saved_views', true), ('business', 'custom_fields', true),

    ('agency', 'crm_import', true), ('agency', 'crm_export', true),
    ('agency', 'ai_replies', true), ('agency', 'ai_proposals', true),
    ('agency', 'automations', true), ('agency', 'analytics', true),
    ('agency', 'instagram_channel', true), ('agency', 'whatsapp_channel', true),
    ('agency', 'saved_views', true), ('agency', 'custom_fields', true)
) as f(tier, flag_key, enabled) on f.tier = p.tier
where p.plan_version = '2026-09-v2'
on conflict (plan_id, flag_key) do nothing;

commit;
