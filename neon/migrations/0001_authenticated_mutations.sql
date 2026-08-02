-- User-initiated Preview mutations. The Data API grants table privileges;
-- PostgreSQL RLS remains the authority for every workspace-scoped row.

alter type public.automation_recipe
  add value if not exists 'WHATSAPP_CONSENTED_FOLLOWUP_REMINDER';
alter type public.automation_recipe
  add value if not exists 'CROSS_CHANNEL_AFTER_HOURS_ESCALATION';

grant update (name, updated_at) on public.workspaces to authenticated;
grant update (
  current_step, completed_steps, skipped_steps, stage_data, last_saved_at,
  auth_completed_at, updated_at
) on public.onboarding_states to authenticated;
grant update (
  timezone, default_locale, preferred_theme, business_category, country_code,
  updated_at
) on public.workspace_settings to authenticated;

drop policy if exists workspaces_update_manager on public.workspaces;
create policy workspaces_update_manager on public.workspaces
  for update to authenticated
  using (private.can_manage_workspace(id))
  with check (private.can_manage_workspace(id));

drop policy if exists onboarding_states_update_manager on public.onboarding_states;
create policy onboarding_states_update_manager on public.onboarding_states
  for update to authenticated
  using (private.can_manage_workspace(workspace_id))
  with check (
    private.can_manage_workspace(workspace_id)
    and user_id = (select auth.user_id()::uuid)
  );

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'campaign_sources', 'automations', 'automation_versions',
    'automation_triggers', 'automation_questions', 'automation_rules',
    'automation_message_steps', 'service_windows', 'automation_runs',
    'automation_run_steps', 'outbound_attempts',
    'automation_idempotency_keys', 'automation_dead_letters',
    'human_takeovers', 'automation_audit_events'
  ]
  loop
    execute format(
      'grant insert, update, delete on public.%I to authenticated', table_name
    );
    execute format('drop policy if exists %I on public.%I', table_name || '_insert_operator', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_update_operator', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_delete_operator', table_name);
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
end
$$;

grant insert, update, delete on public.meta_connections to authenticated;
drop policy if exists meta_connections_insert_manager on public.meta_connections;
drop policy if exists meta_connections_update_manager on public.meta_connections;
drop policy if exists meta_connections_delete_manager on public.meta_connections;
create policy meta_connections_insert_manager on public.meta_connections
  for insert to authenticated with check (private.can_manage_workspace(workspace_id));
create policy meta_connections_update_manager on public.meta_connections
  for update to authenticated using (private.can_manage_workspace(workspace_id))
  with check (private.can_manage_workspace(workspace_id));
create policy meta_connections_delete_manager on public.meta_connections
  for delete to authenticated using (private.can_manage_workspace(workspace_id));
