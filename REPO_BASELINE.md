# Repository Baseline — P0

Recorded before any mutation, per
`Rellooma_V1_Backend_Launch_MD_Pack/00_governance/02_REPOSITORY_RECONCILIATION.md`.

## Identity

| Field             | Value                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------- |
| Repository        | `github.com/sigma83l/meta-automation-crm` (remote `personal`, **public**)                   |
| Second remote     | `github.com/Metric-One/meta-automation-crm` (remote `origin`, private)                      |
| Branch            | `feature/v2-platforms`                                                                      |
| BASE_SHA          | `c9c88ed532d4601e8206bdcd04c000f16661bd45`                                                  |
| Dirty state       | 4 untracked paths (`.claude/`, `handoff.pdf`, `tests/fixtures/fake-supabase.ts`, this pack) |
| Production branch | `release/v1-preview` @ `93e1e6b` (Rellooma v11 UI merge)                                    |

The pack is titled **V1**; the repository is mid-**V2**. The owner has confirmed
the pack's naming and versioning predate the current V2 designation. Phase and
gate names are used as written; product version numbers in the pack are treated
as historical labels, not as instructions to renumber the repository.

## Runtime

Node 24.15.0 (`.nvmrc` pins 22 LTS) · pnpm 11.17.0 · Next.js 16.2.12 ·
React 19.2.8 · TypeScript 5.9.3 strict (`skipLibCheck: false`,
`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) · Vitest 4.1.10 ·
Playwright 1.62.0 · Supabase CLI 2.110.0 · Inngest 4.13.0.

## Boundaries

- Public site: not in this repository.
- Authenticated app: `app/` — 21 pages.
- API/server boundary: `app/api/` — 33 route handlers, plus `proxy.ts`
  middleware gating `protectedPrefixes`.
- Domain code: `src/modules/*` with provider SDK types confined to adapters.

## Database

9 forward-only migrations, head
`20260730010000_billing_subscriptions.sql` (**uncommitted-origin work, never
applied to any hosted project**). 60 tables across `public` and `private`.

RLS: every tenant table uses `enable` + `force row level security`, `revoke all
from anon, authenticated`, `grant all to service_role`, and member-scoped
`select` policies via `private.is_active_member(workspace_id)`. Ciphertext
columns are excluded at the column-grant layer, not merely by RLS. Verified by
execution against PostgreSQL 18.3 (`tests/migrations/billing-schema.test.ts`).

## Auth and workspace resolution

`public.resolve_workspace(workspace_hint)` — `security definer`, `search_path=''`,
inner-joins `workspace_memberships` + `workspaces` + `profiles` +
`onboarding_states`, filtered on `auth.uid()` and `status='active'`. Browser
workspace hints are never authority. Verified working against the hosted project
for real users.

## Meta connector

`meta_connections` + `meta_oauth_nonces` + `meta_webhook_events` +
`provider_event_outbox`. Signed single-use OAuth state stored as SHA-256 hash.
Webhook signature verified over untouched raw bytes with `timingSafeEqual`.
Sandbox adapters only; `META_CONNECTION_MODE=sandbox`,
`LIVE_PROVIDER_SEND_ENABLED=false`.

## Background jobs

6 registered Inngest functions: Meta outbox relay, verified Meta event
processor, expired-artifact cleanup, billing outbox relay, verified billing
webhook processor, due-charge cron.

## Tests and CI

23 unit files, 7 integration, 8 E2E, 1 migration-execution file. `pnpm test`
currently green. CI (`.github/workflows/ci.yml`) runs format, lint, typegen,
typecheck, unit, migrations, Supabase db/integration, load check, build, bundle
scan, secret scan, prod audit, and Playwright E2E.

## Environments

Production on Vercel (`app.rellooma.com`), Supabase project
`kkkfrmxlxtubdvksfjqi` (region ap-south-1). Preview and Production Supabase
variables are stored **sensitive/write-only** in Vercel and cannot be read back.
`/api/health` now probes Supabase and Cloudflare Turnstile reachability
directly rather than reporting mere variable presence.

## Provider identities (non-secret)

| Provider         | Identifier                                        |
| ---------------- | ------------------------------------------------- |
| Supabase project | `kkkfrmxlxtubdvksfjqi`                            |
| Vercel project   | `prj_nuvidPMiWEOS0enutrYfGEmAvyA9` (team `pe2s`)  |
| Meta app         | `1597160428639176` (sandbox mode)                 |
| Turnstile widget | `0x4AAAAAAEFLsCPOkuWeWuli` (production)           |
| Payment provider | PayTR (`PAYMENT_PROVIDER_MODE`, currently `fake`) |

## Schema mapping — pack objects to existing canonical objects

The pack forbids duplicating equivalent objects. Existing equivalents:

| Pack object                         | Existing canonical object     |
| ----------------------------------- | ----------------------------- |
| `memberships`                       | `workspace_memberships`       |
| `contacts`                          | `customers`                   |
| `contact_identities`                | `customer_channel_identities` |
| `consents`                          | `customer_consents`           |
| `connections` / `provider_accounts` | `meta_connections`            |
| `subscriptions`                     | `workspace_subscriptions`     |
| `billing_events`                    | `billing_webhook_events`      |
| `handoffs`                          | `human_takeovers`             |
| `audit_logs`                        | six per-domain audit tables   |
| `agent_runs` (partial)              | `ai_execution_audit_events`   |
| `attribution_touchpoints` (partial) | `campaign_sources`            |

Genuinely absent, requiring new objects: `contact_facts`, `opportunities`,
`qualification_evidence`, `lifecycle_events`, `tasks_followups`, `appointments`,
`agent_snapshots`, `conversation_summaries`, `knowledge_sources`,
`conversion_events`, `entitlements`, `billing_cycles`, `usage_ledger`,
`deletion_ledger`, `support_tickets`.

## Known conflicts

See `CONFLICT_REGISTER.md`.
