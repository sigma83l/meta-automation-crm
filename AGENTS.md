# Repository Operating Rules

## Product

This independent repository builds a multi-business social media automation
CRM for 10–20 isolated business workspaces. It is not MetricOne. Scope covers
the Meta family (WhatsApp, Instagram — including content publishing —, and
Facebook Pages) plus additional platform connectors (LinkedIn, X, TikTok),
each following the same sandbox-first, workspace-scoped connector pattern.
Outbound sends, content publishing, and ads spend are all real-provider
actions and stay behind the same live-send safety gate (env gate, explicit
approval, allowlist/scope limits, default deny) regardless of platform.

## Layout

- `app/`: Next.js routes and presentation.
- `src/modules/`: business modules and provider seams.
- `src/lib/`: shared infrastructure contracts and safe primitives.
- `supabase/migrations/`: fresh migrations only.
- `tests/`: unit, integration, E2E, and synthetic fixtures.
- `docs/`: architecture, security, decisions, setup, and reports.

## Safe commands

Use the locked pnpm version. Safe local commands are `pnpm dev`,
`pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm test:e2e`, `pnpm build`, and `pnpm secret:scan`. Formatting writes
require an implementation task. Never run donor commands.

Local database commands are `pnpm db:start`, `pnpm db:reset`, `pnpm test:db`,
`pnpm test:integration:local`, and `pnpm db:stop`. Never target a hosted project
without explicit approval.

Production preparation commands are `pnpm load:check` and
`pnpm production:preflight`. A production command additionally requires an
approved owner, commercial hosting plan, explicit change approval and the
environment matrix. Never run the 1,000-user profiles on Hobby/unverified
hosting or against customer data.

## Non-negotiable rules

- Every business-owned record must be workspace scoped. Browser-supplied
  workspace IDs are hints, never authority. Server-resolved membership and RLS
  must agree.
- Service-role credentials are server-only and must receive a trusted resolved
  workspace plus an explicit Owner/Admin/Operator role check for every write.
- Viewer is read-only. Operator may change CRM/automations. Owner/Admin alone
  may change business settings, credentials and provider connections.
- Provider-specific SDK types stop at adapters; domain modules use
  application-owned interfaces.
- OAuth state must be short lived, signed, workspace/channel bound, stored only
  as a hash, and consumed exactly once. Provider media URLs are never trusted
  download targets; resolve opaque provider IDs in a server-only adapter.
- Real sends require the environment gate, explicit approval, recipient
  allowlist, current provider policy, and a real adapter. Default is deny.
- Donor repositories are permanently read-only. Do not copy source, migrations,
  environment files, secrets, data, sessions, or branded assets.
- Never print, log, commit, fixture, export, or expose secret values or real PII.
- Security audit overrides require a patched upstream release or a narrow,
  reviewed compatibility patch plus lint/build regression proof.
- External account, billing, legal, MFA, DNS, deployment, and provider actions
  require MANI approval.
- Scheduled cleanup and outbox handlers must remain idempotent, bounded and
  safe when retried. A provider send with uncertain persistence is
  `sent_unknown`, never blindly retried.
- V1 UI copy must keep en/tr/fa parity. Persian applies document-level RTL;
  machine identifiers remain bidi-isolated. Light/Dark/System use semantic
  tokens, never route-specific authorization colors.
- Production public signup fails closed until confirmation delivery is proven.
  Prompt 10 preflight requires invite-only otherwise, Meta Sandbox and
  `LIVE_PROVIDER_SEND_ENABLED=false`.
- Onboarding drafts may contain bounded non-secret owner inputs only. Never
  place provider credentials, tokens or recovery values in setup state.

## Definition of done

Formatting, lint, strict typecheck, unit/integration/E2E tests, production build,
secret scan, diff review, security review, and documentation must pass. Fix root
causes and add regression coverage; do not weaken gates.

## Required final report

Report exact path, branch/SHA, changed files, versions, commands/results, bugs
fixed, risks, external gates, donor before/after proof, and the prompt status.
Stop at the active prompt gate.
