begin;
select plan(21);

select has_table('public', 'customers', 'customers exists');
select has_table('public', 'customer_channel_identities', 'identities exist');
select has_table('public', 'customer_consents', 'consents exist');
select has_table('public', 'custom_field_definitions', 'field definitions exist');
select has_table('public', 'customer_custom_field_values', 'field values exist');
select has_table('public', 'conversations', 'conversations exist');
select has_table('public', 'messages', 'messages exist');
select has_table('public', 'customer_files', 'customer files exist');
select has_table('public', 'export_jobs', 'export jobs exist');

select ok(relrowsecurity, 'customers RLS') from pg_class where oid = 'public.customers'::regclass;
select ok(relforcerowsecurity, 'customers forced RLS') from pg_class where oid = 'public.customers'::regclass;
select ok(relrowsecurity, 'conversations RLS') from pg_class where oid = 'public.conversations'::regclass;
select ok(relrowsecurity, 'messages RLS') from pg_class where oid = 'public.messages'::regclass;
select ok(relrowsecurity, 'customer files RLS') from pg_class where oid = 'public.customer_files'::regclass;
select ok(relrowsecurity, 'export jobs RLS') from pg_class where oid = 'public.export_jobs'::regclass;

select is((select public from storage.buckets where id = 'customer-media'), false, 'media bucket private');
select is((select public from storage.buckets where id = 'crm-exports'), false, 'export bucket private');
select is((select file_size_limit from storage.buckets where id = 'customer-media'), 10485760::bigint, 'media size capped');
select is((select file_size_limit from storage.buckets where id = 'crm-exports'), 104857600::bigint, 'export size capped');
select ok(
  (
    select count(distinct cmd) = 4
    from pg_policies
    where schemaname = 'storage'
      and policyname in (
        'customer_media_select_member',
        'private_objects_insert_operator',
        'private_objects_update_operator',
        'private_objects_delete_operator'
      )
  ),
  'media has select plus role-aware write policies'
);
select ok(
  (
    select count(distinct cmd) = 4
    from pg_policies
    where schemaname = 'storage'
      and policyname in (
        'crm_exports_select_member',
        'private_objects_insert_operator',
        'private_objects_update_operator',
        'private_objects_delete_operator'
      )
  ),
  'exports have select plus role-aware write policies'
);

select * from finish();
rollback;
