-- P1 — tenant index coverage
--
-- Every tenant table is protected by a policy of the form
-- `private.is_active_member(workspace_id)`, so workspace_id appears as a
-- predicate on effectively every authenticated read. Seventeen such tables had
-- no index whose leading column was workspace_id, which forces a sequential
-- scan for the RLS check alone. That is invisible at demo scale and becomes the
-- first thing to fail under real tenant counts.
--
-- Composite where a natural ordering exists, so the common "latest N for this
-- workspace" read is satisfied by the index rather than by a sort.
--
-- Deliberately excluded: provider_event_outbox and billing_provider_event_outbox.
-- Both are service-role only with no authenticated grant, and are polled by
-- claim state rather than by tenant, so a workspace-leading index would serve no
-- query they actually run.

-- Audit trails: always read as "recent activity for this workspace".
create index if not exists ai_execution_audit_events_workspace_recent
  on public.ai_execution_audit_events (workspace_id, created_at desc);
create index if not exists automation_audit_events_workspace_recent
  on public.automation_audit_events (workspace_id, created_at desc);
create index if not exists billing_audit_events_workspace_recent
  on public.billing_audit_events (workspace_id, created_at desc);
create index if not exists crm_audit_events_workspace_recent
  on public.crm_audit_events (workspace_id, occurred_at desc);
create index if not exists meta_connection_audit_events_workspace_recent
  on public.meta_connection_audit_events (workspace_id, created_at desc);

-- Automation configuration: filtered by workspace, ordered by nothing in
-- particular, so a plain workspace index is the right shape.
create index if not exists automation_rules_workspace
  on public.automation_rules (workspace_id);
create index if not exists automation_triggers_workspace
  on public.automation_triggers (workspace_id);
create index if not exists automation_run_steps_workspace
  on public.automation_run_steps (workspace_id);
create index if not exists automation_dead_letters_workspace_recent
  on public.automation_dead_letters (workspace_id, created_at desc);

-- Billing reads are per workspace; charge attempts carry no timestamp column,
-- so the tenant key alone is the useful index.
create index if not exists billing_charge_attempts_workspace
  on public.billing_charge_attempts (workspace_id);
create index if not exists billing_webhook_events_workspace_recent
  on public.billing_webhook_events (workspace_id, received_at desc);

-- CRM detail tables, all reached from a workspace-scoped customer view.
create index if not exists customer_contact_methods_workspace
  on public.customer_contact_methods (workspace_id);
create index if not exists customer_automation_references_workspace
  on public.customer_automation_references (workspace_id);
create index if not exists customer_notes_workspace_recent
  on public.customer_notes (workspace_id, created_at desc);

-- Inbox and takeover state.
create index if not exists human_takeovers_workspace_recent
  on public.human_takeovers (workspace_id, started_at desc);
create index if not exists meta_webhook_events_workspace_recent
  on public.meta_webhook_events (workspace_id, occurred_at desc);

-- Resolved on every authenticated request through resolve_workspace.
create index if not exists profiles_workspace
  on public.profiles (workspace_id);
