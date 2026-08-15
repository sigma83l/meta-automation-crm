# Execution Lock

**Source pages:** 1–2

## Mission

Turn the already-designed Rellooma Website + App into a real multi-tenant production system for Instagram DM + WhatsApp.

The backend must:

1. Ingest supported Meta messages.
2. Build cross-channel Contact/CRM memory.
3. Execute the RCOS decision pipeline.
4. Control AI under deterministic policy and permissions.
5. Execute follow-up, handoff, booking/action flows audibly and idempotently.
6. Enforce Trial, Paddle entitlement, and usage server-side.
7. Return all real states to the already-final UI.
8. Produce operational evidence sufficient for V1 Launch acceptance.

## Developer must build

- Data model, migrations, indexes, RLS.
- Auth/workspace/account contracts.
- Instagram + WhatsApp connector lifecycle.
- RCOS + AI router + context + memory + validator.
- CRM, qualification, follow-up, handoff, verified outcome logic.
- Versioned automation runtime and side-effect control.
- Paddle, trial, entitlements, usage metering, reconciliation.
- Analytics, attribution, read models, AI telemetry.
- Email/support async flows.
- Observability, backup, security, tests, evidence, rollout.

## Developer must not do

- Redesign or replace the final UI/UX with a second framework.
- Rewrite correct Auth/RLS/Meta flows without evidence.
- Use the LLM as authority for money/time/booking/billing/status.
- Trust client-provided workspace/role/entitlement.
- Use Production DB/secrets/provider tokens in Preview.
- Scatter provider IDs/model IDs/quotas/config values in source files.

## Repository caveat

Before the first mutation, discover and record:

- Repository full name, branch, exact base SHA, dirty state.
- Runtime/framework versions.
- Route tree and server actions/API routes.
- Existing DB schema and migrations.
- Auth, RLS, storage, Meta semantics.
- CI checks and current tests.
- Existing provider projects/account IDs **without exposing secrets**.

No blind backend rewrite is authorized.
