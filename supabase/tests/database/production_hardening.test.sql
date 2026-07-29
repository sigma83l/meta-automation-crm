begin;
select plan(14);

select has_table('private', 'auth_rate_limits', 'private auth limiter state exists');
select has_table('public', 'crm_import_jobs', 'CRM import audit jobs exist');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.crm_import_jobs'::regclass),
  'CRM import jobs use RLS'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.crm_import_jobs'::regclass),
  'CRM import job RLS is forced'
);
select ok(
  not has_table_privilege('authenticated', 'private.auth_rate_limits', 'SELECT'),
  'browser cannot read rate limit state'
);
select ok(
  not has_table_privilege('authenticated', 'public.crm_import_jobs', 'INSERT'),
  'browser cannot forge import jobs'
);
select ok(
  has_function_privilege(
    'anon',
    'public.consume_auth_rate_limit(text,integer,integer)',
    'EXECUTE'
  ),
  'anonymous auth routes may atomically consume a limit'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.import_crm_rows(uuid,uuid,text,jsonb)',
    'EXECUTE'
  ),
  'trusted server may run atomic CRM imports'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.import_crm_rows(uuid,uuid,text,jsonb)',
    'EXECUTE'
  ),
  'browser cannot invoke privileged CRM import'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.purge_expired_auth_rate_limits(integer)',
    'EXECUTE'
  ),
  'trusted cleanup worker may purge expired limiter state'
);
select ok(
  'WHATSAPP_CONSENTED_FOLLOWUP_REMINDER' = any(enum_range(null::public.automation_recipe)::text[]),
  'consented reminder recipe is migrated'
);
select ok(
  'CROSS_CHANNEL_AFTER_HOURS_ESCALATION' = any(enum_range(null::public.automation_recipe)::text[]),
  'safe escalation recipe is migrated'
);
select ok(
  array['owner','admin','operator','viewer'] <@ enum_range(null::public.membership_role)::text[],
  'workspace roles are explicit'
);
select ok(
  public.consume_auth_rate_limit(repeat('a', 64), 1, 60)
  and not public.consume_auth_rate_limit(repeat('a', 64), 1, 60),
  'database limiter atomically denies the next attempt'
);

select * from finish();
rollback;
