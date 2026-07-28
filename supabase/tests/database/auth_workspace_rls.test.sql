begin;
select plan(13);

select has_table('public', 'workspaces', 'workspaces exists');
select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'workspace_memberships', 'memberships exist');
select has_table('public', 'workspace_settings', 'settings exist');
select has_table('public', 'onboarding_states', 'onboarding exists');
select has_table('public', 'auth_audit_events', 'audit exists');

select ok(relrowsecurity, 'RLS enabled on workspaces')
from pg_class where oid = 'public.workspaces'::regclass;
select ok(relforcerowsecurity, 'RLS forced on workspaces')
from pg_class where oid = 'public.workspaces'::regclass;
select ok(relrowsecurity, 'RLS enabled on profiles')
from pg_class where oid = 'public.profiles'::regclass;
select ok(relrowsecurity, 'RLS enabled on memberships')
from pg_class where oid = 'public.workspace_memberships'::regclass;
select ok(relrowsecurity, 'RLS enabled on settings')
from pg_class where oid = 'public.workspace_settings'::regclass;
select ok(relrowsecurity, 'RLS enabled on onboarding')
from pg_class where oid = 'public.onboarding_states'::regclass;
select is(
  (select public from storage.buckets where id = 'crm-private'),
  false,
  'CRM media bucket is private'
);

select * from finish();
rollback;
