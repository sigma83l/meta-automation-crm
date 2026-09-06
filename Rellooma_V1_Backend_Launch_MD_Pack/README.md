# Rellooma V1 Backend & Launch Developer Pack

**Purpose:** convert the complete 47-page `Rellooma V1 Backend & Launch Developer Specification 2026` into an English, repository-ready Markdown implementation pack.

## Execution assumption

This pack assumes the final Website and App UI/UX packs have already been executed. The developer is **not** asked to redesign the product. The developer must bind the final UI to real backend state, real provider state, real policy state, real billing state, and real production evidence.

## V1 definition

Rellooma V1 is complete only when:

`UI truth = backend truth = provider truth`

A real allowed Instagram DM or WhatsApp message must be ingested, deduplicated, identity-resolved, policy-checked, processed by RCOS/AI, executed only through allowed tools, verified by authoritative systems, persisted into CRM/billing/usage/analytics, and shown in the final UI without mocks.

## Non-negotiable constraints

- Preserve correct existing Auth/RLS/Meta semantics unless evidence proves they must change.
- Current repository/runtime/tests outrank this pack when there is a conflict; document the conflict rather than silently overwriting.
- LLMs are never the source of truth for money, time, availability, booking, payment, entitlement, workspace, or role.
- Browser/client state never grants workspace, role, subscription, entitlement, or provider authority.
- Preview/Staging never shares Production DB, provider tokens, webhook secrets, email credentials, Paddle keys, or AI secrets.
- Provider IDs, model IDs, quotas, and pricing references must be versioned/configurable, never scattered hard-coded constants.
- Public production claims require evidence.

## Folder map

- `00_governance/` — execution lock, authority, conflict rules, repo reconciliation.
- `01_architecture/` — topology, module boundaries, data flow, sync map.
- `02_data_identity_security/` — schema, migrations, RLS, RBAC, auth/account lifecycle.
- `03_connectors_automation/` — Meta lifecycle, automation runtime, queues, idempotency.
- `04_ai_rcos_crm/` — RCOS, AI router/context, structured contracts, CRM intelligence.
- `05_billing_usage/` — Paddle, trial, entitlements, metering, reconciliation.
- `06_site_backend/` — dynamic site backend and public route contracts.
- `07_app_backend/` — final App route-to-backend contracts and UI state contract.
- `08_analytics_growth/` — event taxonomy, attribution, read models, AI telemetry.
- `09_email_support/` — transactional/marketing email and support-ticket backend.
- `10_infrastructure_ops/` — environments, secrets, observability, performance, backup/deletion.
- `11_quality_release/` — CI/CD, tests, launch gates, 0→launch sequence, 100-point checklist.
- `12_runbooks/` — mandatory operational runbook templates.
- `13_templates/` — evidence pack, conflict register, provider review, route audit, golden-set templates.
- `14_execution_prompt/` — locked developer execution prompt for implementation.

## Source traceability

Every core Markdown file includes the corresponding PDF page range. The package intentionally excludes company P&L, taxes, valuation, and profit-share calculations; only technical billing/trial/usage behavior from the source specification is included.
