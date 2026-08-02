-- Prompt 10: persistent locale/theme preferences and resumable V1 setup.

alter table public.profiles
  add column locale text not null default 'en'
    check (locale in ('en', 'tr', 'fa')),
  add column theme text not null default 'system'
    check (theme in ('light', 'dark', 'system'));

alter table public.workspace_settings
  add column default_locale text not null default 'en'
    check (default_locale in ('en', 'tr', 'fa')),
  add column preferred_theme text not null default 'system'
    check (preferred_theme in ('light', 'dark', 'system')),
  add column business_category text,
  add column country_code text
    check (country_code is null or country_code ~ '^[A-Z]{2}$');

alter table public.onboarding_states
  add column skipped_steps text[] not null default '{}'::text[],
  add column stage_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(stage_data) = 'object'),
  add column last_saved_at timestamptz;

grant update (locale, theme) on table public.profiles to authenticated;

create or replace function private.valid_onboarding_stage(stage text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select stage = any(array[
    'welcome',
    'business-profile',
    'languages',
    'knowledge',
    'ai-mode',
    'channels',
    'first-recipe',
    'simulation'
  ]::text[]);
$$;

revoke all on function private.valid_onboarding_stage(text) from public, anon, authenticated;

comment on column public.onboarding_states.stage_data is
  'Bounded non-secret draft setup fields. Provider credentials and tokens are forbidden.';
comment on column public.profiles.locale is
  'Owner UI locale; customer-message language remains a separate business setting.';
comment on column public.profiles.theme is
  'Owner UI theme preference: light, dark, or system.';
