# V2 Scope — Platform Expansion and Monetization

V1 (`release/v1-preview`, locked by `V1_SCOPE_LOCK.md`) stays exactly as
shipped: Instagram + WhatsApp, inbound-first, no bulk campaigns, no expanded
provider authority. This document defines a separate, additive scope for V2
and lives only on `feature/v2-platforms` (and its descendants) until merged
and explicitly promoted.

V2 contains two distinct workstreams. The larger one is platform expansion.
The smaller, sequenced first, is monetization: workspace subscription
billing, which is a commercial prerequisite for operating the product at all
rather than another connector.

## Product

V2 broadens the product from an Instagram/WhatsApp automation CRM to a
multi-platform social automation CRM, and makes it a paid product with an
enforced trial/subscription boundary. Same tenancy model (10–20 isolated
business workspaces), same non-negotiable rules in `AGENTS.md` (workspace
scoping, RLS, provider SDK types stopped at adapters, fail-closed live
sends).

| Capability                                                                                | Disposition                                       |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Workspace subscription billing (card-upfront trial, recurring charge, entitlement gating) | REQUIRED, first — commercial prerequisite         |
| Trial-abuse control by payment-card fingerprint                                           | REQUIRED                                          |
| Swappable payment-provider seam (PayTR first real adapter)                                | REQUIRED                                          |
| Facebook Pages (Messenger, comments, Lead Ads) inbound                                    | REQUIRED                                          |
| Instagram content (posts/comments), not just DMs                                          | REQUIRED                                          |
| Non-Meta connectors: LinkedIn, X, TikTok (sandbox-first)                                  | REQUIRED                                          |
| Outbound content publishing (Facebook/Instagram)                                          | REQUIRED                                          |
| Outbound messaging/auto-reply automation                                                  | REQUIRED                                          |
| Ads management (campaigns, budgets, insights)                                             | REQUIRED, last — real budget risk, strictest gate |
| Customer-facing catalog, orders and checkout for a workspace's own buyers                 | still DEFER_P1                                    |
| Anything V1 already REJECTed (scraping, voice, autonomous action runtime)                 | still REJECT                                      |

The DEFER_P1 row is deliberate. `V1_SCOPE_LOCK.md` defers "catalog, orders,
payments" as customer-facing commerce, and that stays deferred. V2 billing is
a different thing: the workspace itself paying us for the product.

## Relationship to V1

- No edits to `V1_SCOPE_LOCK.md` or the v1-preview release behavior.
- No schema changes to existing `meta_connections`/`meta_webhook_events` rows
  or semantics for `whatsapp`/`instagram` DM channels — only additive columns
  and new channel/provider values.
- Billing is additive in the same sense: new tables, new RPCs and one new
  `after insert on public.workspaces` trigger, alongside the existing
  onboarding/business-profile trigger rather than replacing it. It does not
  alter `private.handle_new_user()` or any V1 table.
- Entitlement enforcement does change V1 runtime behavior for an unpaid
  workspace, so it is a promotion-gated change like any other: it must not
  reach `release/v1-preview` without MANI approval.
- Merge to `release/v1-preview` (or its successor) only after MANI approval,
  same as any provider/account-affecting change per `AGENTS.md`.

## Architecture decisions carried into V2

- **Facebook Pages** and **Instagram content** extend the existing Meta App /
  OAuth / encrypted token vault (`meta_connections`), since they're the same
  provider and app as WhatsApp/Instagram DMs — new `channel` values and
  nullable columns, not new tables.
- **LinkedIn / X / TikTok** are genuinely separate OAuth ecosystems (separate
  developer apps, token shapes, rate limits, review processes). They get a
  new, generalized, provider-agnostic connector foundation
  (`social_connections`, `social_webhook_events`, `social_event_outbox`,
  `social_connection_audit_events`) rather than being forced into `meta_*`
  naming/schema built specifically for Meta.
- **Payment providers** get the same treatment as social providers: PayTR is
  integrated behind an application-owned `PaymentProvider` interface
  (`src/modules/billing/contracts.ts`), provider SDK/wire types stop at the
  adapter, and a deterministic fake adapter is the dev/test default (D-027 in
  `DECISIONS.md`).
- All new provider tokens reuse the existing credential vault
  (`src/modules/ai/credential-vault.ts` pattern), never a new encryption
  scheme. Stored card/customer references are AES-256-GCM envelopes in
  `billing_payment_methods` under that same seam.
- Real sends/publishes/spend all require the existing fail-closed pattern
  (D-005 in `DECISIONS.md`): env gate, explicit approval, allowlist/scope
  limit, current provider policy, real adapter — default deny. Live billing
  uses the same shape (`PAYMENT_PROVIDER_MODE=paytr`, `LIVE_BILLING_ENABLED`
  and `BILLING_LIVE_APPROVED` together), plus PayTR's own merchant approval
  for stored-card/recurring capability — an external gate outside this
  repository, like Meta's live-mode review.
- An ambiguous charge outcome is recorded as `charge_unknown` and never
  auto-retried, the same uncertain-persistence rule the automation engine
  applies to `sent_unknown` provider sends.

## Sequencing

**Phase 0 — Billing and monetization.** A separate workstream, not a step in
the connector sequence, and sequenced first for two reasons: it is a
commercial prerequisite (platform breadth has no value if the product cannot
charge for it), and it touches the workspace resolver that every later phase
builds on, so it is cheaper to land before four new connectors depend on that
seam. It does not block or depend on any connector work, and connector phases
must not be reordered around it.

Then, in order:

1. Facebook Pages inbound (extends Meta module).
2. Instagram content inbound + outbound publishing.
3. Generalized non-Meta connector foundation (contracts + schema).
4. LinkedIn, X, TikTok connectors (sandbox-first, in that order — LinkedIn
   fits the CRM/lead-gen use case most directly; TikTok's business API review
   is typically slowest, so its adapter is built early but real credentials
   likely land last).
5. Outbound messaging/auto-reply automation, once inbound → CRM wiring is
   proven across platforms.
6. Ads management, once connectors exist for the platforms being advertised
   on.

Each phase follows the repository's existing Definition of Done: format,
lint, strict typecheck, unit/integration/E2E tests, production build, secret
scan, diff review, security review, documentation.

## Status

As of 2026-08-13, on `feature/v2-platforms`:

| Phase                                       | State                    |
| ------------------------------------------- | ------------------------ |
| Phase 0 — billing and monetization          | implemented, uncommitted |
| 1 — Facebook Pages inbound                  | not started              |
| 2 — Instagram content + outbound publishing | not started              |
| 3 — non-Meta connector foundation           | not started              |
| 4 — LinkedIn / X / TikTok connectors        | not started              |
| 5 — outbound messaging automation           | not started              |
| 6 — ads management                          | not started              |

Phase 0 was authored in early August 2026 and is present only as uncommitted
working-tree changes. It covers `src/modules/billing/` (contracts, trial
policy, entitlement + entitlement gate, subscription service, live-billing
gate, callback state, webhook ingestion, fake and PayTR adapters, PayTR
signature helpers, billing UI), the `/api/billing`, `/api/billing/start`,
`/api/billing/callback` and `/api/webhooks/paytr` routes, the
`/settings/billing` page, migration
`supabase/migrations/20260730010000_billing_subscriptions.sql`, three new
Inngest functions (`relay-billing-outbox`, `process-verified-billing-webhook`,
`charge-due-trials-and-subscriptions`, taking the registered count to six),
the billing environment variables in `docs/ENVIRONMENT_VARIABLES.md`, and
unit tests for the PayTR signature, callback state and provider adapters.
`resolveEntitledWorkspace` is currently wired into the CRM, business-profile
and Meta-connection runtimes; the dashboard overview and billing itself stay
on the plain resolver by design.

Phase 0 is not finished as a release unit: it has not been committed,
reviewed, MANI-approved or merged, its migration has not been applied to a
hosted environment, `PAYMENT_PROVIDER_MODE` defaults to `fake` everywhere,
and the PayTR adapter has been cross-checked against PayTR's published
request formats but never exercised against a real merchant account from this
repository.

Nothing in phases 1–6 has been started. There is no `social_connections`
schema, no Facebook Pages channel and no non-Meta adapter in the tree; the
only reference to that foundation is this document.
