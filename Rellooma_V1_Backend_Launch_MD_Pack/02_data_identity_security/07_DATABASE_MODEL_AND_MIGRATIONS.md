# Database Model and Migration Plan

**Source pages:** 7–8

The source specification defines the minimum domain objects below. Exact SQL types must be reconciled with the current repository; do not invent duplicate tables when equivalent canonical objects already exist.

## Core objects

### Tenant and account
- `workspaces`: id, name, locale, timezone, status, config_version.
- `memberships`: workspace_id, user_id, role, status, invited_at.
- `workspace_settings`: workspace_id, settings_json, version.
- `onboarding_states`: workspace_id, stage, completed_at, blockers.

### Provider connections
- `connections`: workspace_id, provider, state, health, last_sync_at.
- `provider_accounts`: connection_id, external_account_id, token_ref, metadata.

### Contacts and conversations
- `contacts`: workspace_id, display_name, locale, lifecycle_stage.
- `contact_identities`: contact_id, channel, external_id, verified/source.
- `conversations`: workspace_id, contact_id, channel, status, owner_id, ai_mode.
- `messages`: conversation_id, direction, provider_message_id, delivery_status, payload_hash.

### CRM and policy
- `contact_facts`: fact_key, value, source, confidence, valid_from/to, sensitivity.
- `consents`: type, scope, status, source, timestamp.
- `opportunities`: stage, value_band, owner, lost_reason, next_action.
- `qualification_evidence`: signal, weight, evidence_ref, confidence.
- `lifecycle_events`: from, to, reason_codes, evidence, actor.
- `tasks_followups`: reason, due_at, eligibility_state, cancel_condition.
- `appointments`: requested/proposed/booked/completed/no_show + external_id.
- `handoffs`: reason, team, owner, SLA, packet_json.

### AI and knowledge
- `agent_snapshots`: workspace_id, version, hash, token_estimate, policy_refs.
- `conversation_summaries`: conversation_id, version, summary, source_cursor.
- `agent_runs`: router/model/version, input/output schema, confidence, usage.
- `action_logs`: action_type, idempotency_key, result, reversible.
- `knowledge_sources`: type, version, freshness, validity, owner, status.

### Growth/outcomes
- `attribution_touchpoints`: campaign/content/partner/source/medium.
- `conversion_events`: type, source_event, authoritative_ref.

### Billing/usage
- `billing_customers`: workspace_id, customer_id.
- `subscriptions`: provider_id, status, period, scheduled_change, event_cursor.
- `billing_events`: unique event_id, occurred_at, payload_hash, process_state.
- `entitlements`: workspace_id, feature, limit, effective_from/to, config_version.
- `billing_cycles`: workspace_id, start/end, pricing_config_version.
- `usage_ledger`: meter_type, quantity, event_id, tokens, provider/model, idempotency_key.

### Governance/support
- `deletion_ledger`: workspace_id, scope, state, requested_at, completed_at, tombstone_key.
- `support_tickets`: workspace_id, requester, status, priority, SLA, category.
- `audit_logs`: workspace_id, actor, action, object, safe_metadata.

## Migration rules

- Forward-only reviewed migrations.
- Deterministic seed only for non-production fixtures.
- RLS on all exposed tenant tables.
- Index `workspace_id` + common filter/order columns.
- Unique external provider event/message IDs.
- Migration preflight on staging.
- Rollback/restore plan before Production.
