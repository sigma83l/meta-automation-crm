begin;
select plan(12);

select has_column('public', 'profiles', 'locale', 'profile stores UI locale');
select has_column('public', 'profiles', 'theme', 'profile stores UI theme');
select has_column('public', 'workspace_settings', 'default_locale', 'workspace has locale default');
select has_column('public', 'workspace_settings', 'preferred_theme', 'workspace has theme default');
select has_column('public', 'onboarding_states', 'skipped_steps', 'setup tracks skipped stages');
select has_column('public', 'onboarding_states', 'stage_data', 'setup stores bounded draft data');
select has_column('public', 'onboarding_states', 'last_saved_at', 'setup records save time');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.onboarding_states'::regclass),
  'onboarding state keeps RLS'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.onboarding_states'::regclass),
  'onboarding state keeps forced RLS'
);
select ok(
  not has_table_privilege('anon', 'public.onboarding_states', 'SELECT'),
  'anonymous users cannot read setup drafts'
);
select ok(
  not has_table_privilege('authenticated', 'public.onboarding_states', 'UPDATE'),
  'browser sessions cannot forge setup progress directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.valid_onboarding_stage(text)',
    'EXECUTE'
  ),
  'private stage validation is not browser executable'
);

select * from finish();
rollback;
