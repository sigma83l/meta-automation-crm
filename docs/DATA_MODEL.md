# CRM Data Model

All Prompt 2 business tables contain a non-null `workspace_id`. Composite
foreign keys bind related rows to the same workspace, while forced RLS requires
an active membership for every select, insert, update and delete.

## Customer graph

- `customers`: workspace-owned CRM identity and lifecycle.
- `customer_channel_identities`: WhatsApp/Instagram identities.
- `customer_contact_methods`: email and phone methods.
- `customer_consents`: channel consent, lawful basis and opt-out.
- `custom_field_definitions` / `customer_custom_field_values`: typed fields.
- `tags` / `customer_tag_assignments`: workspace tags and assignments.
- `customer_notes`, `customer_activities`: notes and timeline facts.
- `customer_files`: verified private media metadata, checksum and retention.

## Inbox and automation graph

`conversations` stores channel, unread count, human-review state and current
automation/human owner. `messages` stores inbound or prepared outbound content;
Prompt 2 has no provider-send path. `message_attachments` binds messages to
private files. `customer_automation_references` stores safe current/source
references. `crm_audit_events` and `export_jobs` record sensitive actions and
export lifecycle.

## Structured business knowledge and AI

- `business_profiles`: one brand, language/style, hours/timezone, policy,
  confidence, retention, and AI-mode row per workspace.
- `business_faq_items` and `business_price_items`: approved structured facts.
- `workspace_ai_credentials`: server-written encrypted envelopes and masked
  status; plaintext is not a field.
- `ai_execution_audit_events`: metadata-only lifecycle evidence.

All use forced RLS. Credential envelope writes are additionally denied to the
browser role.

## Production hardening

- `workspace_memberships.role`: Owner/Admin/Operator/Viewer authority. Reads
  require active membership; writes additionally require manager/operator
  policy according to the resource.
- `crm_import_jobs`: source filename, lifecycle and aggregate accepted/rejected
  counts only. Customer/contact/timeline/audit inserts happen atomically.
- `private.auth_rate_limits`: HMAC key, count and expiry only. It stores no raw
  email or IP address and is inaccessible to browser roles.

The onboarding row is business-workspace state. Additional members inherit that
state; the resolver no longer requires a second impossible onboarding primary
row.

## Billing and subscriptions

- `subscription_plans`: small global catalog (one row for V1).
- `workspace_subscriptions`: one row per workspace, seeded `incomplete` by an
  `after insert on public.workspaces` trigger (mirrors
  `initialize_business_profile_after_workspace`); transitions to `trialing`,
  `active`, `past_due` or `canceled` only through the
  `transition_workspace_subscription` RPC.
- `billing_payment_methods`: server-managed AES-256-GCM envelopes for the
  provider customer/card tokens only; ciphertext columns are excluded from
  the `authenticated` grant entirely, same as `workspace_ai_credentials`.
- `private.trial_fraud_signals`: HMAC-only, append-only card-fingerprint
  ledger; never purged by TTL, survives workspace deletion.
- `billing_callback_nonces`, `billing_webhook_events` /
  `billing_provider_event_outbox`: single-use signed callback state and the
  verified-webhook/durable-outbox pair, structural copies of the Meta OAuth
  nonce and webhook/outbox tables.
- `billing_charge_attempts`: one row per charge attempt, doubling as the
  provider idempotency key (`orderRef`); `charge_unknown` rows require manual
  reconciliation and are never auto-retried.
- `billing_audit_events`: sensitive billing action evidence (trial started,
  fingerprint reused, charge failed, subscription canceled).

All use forced RLS; members may read masked/status columns only, and every
write goes through service-role code plus the RPCs above.
