# Architecture

## System shape

The application is a Next.js App Router modular monolith. UI, route handlers,
business modules, and infrastructure adapters deploy together, while durable
jobs run through Inngest and state is owned by Supabase Auth, Postgres, and
private Storage.

```text
Browser
  → Next.js routes
    → trusted request/workspace resolution
      → business module interface
        → Supabase repository adapter
        → Inngest durable-job adapter
        → Meta/AI provider adapter
```

Prompt 1 implements the Auth and workspace boundary. Next.js route handlers use
Supabase SSR cookies; `proxy.ts` refreshes sessions and protects dashboard and
onboarding routes. Signup metadata enters one database trigger transaction that
creates the profile, workspace, owner membership, settings, onboarding state,
and initial audit event.

## Module rules

Each module exposes one small application-owned interface. Provider SDK types,
webhook payloads, database rows, and queue event shapes are normalized at their
adapter seams. Callers receive `Result<T>` with stable error codes rather than
provider exceptions.

External services are true external dependencies. Production adapters will be
injected; tests use deterministic adapters at the same seam. The interface is
the primary test surface.

## Tenant authority

The authenticated identity selects no workspace by itself. Server-side
membership resolution establishes the trusted workspace, and every
business-owned table includes `workspace_id`. RLS denies by default. Service
role code stays server-only and accepts an already trusted workspace context.
Storage paths and signed URLs are workspace scoped.

The fresh migration enables and forces RLS on every exposed application table.
`resolve_workspace` derives authority from `auth.uid()` and active membership;
a supplied workspace hint can only narrow that result. Private Storage object
paths begin with the trusted workspace UUID and use the same membership
predicate. The service role remains server-only and is not used by browser
routes.

## Authentication seam

`AuthService` owns input validation, CAPTCHA and rate-limit ordering and generic
public behavior. `SupabaseAuthRepository` owns Auth SDK/session operations.
Turnstile is the production adapter; the deterministic fake accepts only
`local-pass` and is forbidden in production. Mutating auth routes require a
short-lived, HttpOnly, SameSite double-submit CSRF token.

## Provider safety

Outbound work follows:

```text
normalized command
  → current workspace and automation state
  → consent/opt-out and channel-window policy
  → idempotency
  → environment gate
  → explicit live approval
  → test-recipient allowlist
  → provider adapter
```

The foundation fake adapters accept sandbox commands. A live command can pass
the abstract gate only when all approvals are true, but then fails because no
real adapter exists. This prevents configuration alone from enabling a send.

## UI direction

The owner panel uses a light operational canvas, a deep control rail, compact
cards, explicit status text, visible focus, logical properties, and restrained
motion. The signature two-lane signal represents WhatsApp and Instagram
converging on one locked send gate. It is original work; donor branding, assets,
and code were not copied.

Prompt 6 completes the owner surface around that system. `WorkspaceShell`
provides one desktop/tablet rail and a five-item mobile bar. Route components
resolve the trusted workspace on the server; client components receive only the
minimum operational data and call CSRF-protected routes for mutations.

The automation creator is a seven-step stateful form. Creation carries a
per-attempt idempotency key, persists a bounded configuration in an immutable
version, and refreshes the server-rendered list without a hard navigation.
Emergency pause, queued-step cancellation, safe test, activation, takeover and
resume are real server operations, not visual placeholders.

Responsive CSS uses logical properties and has an explicit 390 px RTL
regression. Inbox is three-pane on desktop, two-pane on tablet and single-pane
with back navigation on mobile. Loading, empty, warning, disconnected, reauth,
partial-data and failure states remain explicit text rather than color alone.

## CRM, media and export modules

The CRM repository interface hides workspace resolution, validation, related
contact creation and timeline writes. Its Supabase adapter receives a trusted
workspace from the session; route bodies cannot establish tenant authority.
Composite foreign keys and forced RLS provide the second enforcement layer.

The media module validates bytes, generates safe names, checks limits and
coordinates private Storage with metadata rollback. The export module collects
only a resolved workspace/customer scope, removes secret-like fields, builds
the workbook, references generated relative ZIP paths, and emits a manifest.
Small exports run synchronously; `crm/export.requested` and
`ExportJobDispatcher` define the durable seam for large exports.

## Business knowledge and AI modules

V1 knowledge is one workspace profile plus structured FAQ and price rows.
`AiProvider` is the application-owned interface; SDK types stop at adapters.
Context minimization, mode privacy, strict output validation, and human-review
guardrails run before any future send.

BYOK credentials cross a server-only seam. Membership resolves the trusted
workspace before the service-role adapter stores an AES-256-GCM envelope.
Members may read masked metadata but receive no credential-table write grants.
Paid/BYOK and free synthetic Demo modes are explicit; no automatic fallback
crosses privacy classifications.

## Meta connection and webhook modules

Each workspace owns at most one WhatsApp and one Instagram connection.
Provider account identifiers—not payload workspace fields—route inbound events.
Live tokens use the existing server-only AES-256-GCM envelope seam; browser
queries receive only operational metadata.

The public webhook route verifies the untouched request body before JSON
parsing. Normalization extracts a minimal application event. A service-role-only
database function atomically resolves the active connection, rejects unknown or
unhealthy states, deduplicates by provider event ID, persists the normalized
record, and creates one `meta/webhook.received` outbox row. Webhook
normalization discards provider media URLs and retains only opaque provider
media IDs. A future server-only `ProviderMediaDownloader` must resolve those IDs
through an allowlisted provider API and then use private Storage.

OAuth state is HMAC-bound to workspace, channel, nonce and expiry. Only a
SHA-256 hash is stored server-side, and an atomic service-role function consumes
the hash exactly once before server-only code exchange. The adapter posts codes
only to fixed Meta hosts, verifies the returned Instagram identity or
WABA/phone relationship, and encrypts the token before returning safe metadata.
Expired, future-dated, cross-workspace, tampered and replayed values fail
closed.

## Inbound pipeline: from a verified event to a turn

The relay hands a verified event to a handler that does three things in order,
each idempotent on its own, because a retry must not repeat the ones that
already succeeded.

**Projection.** `project_meta_message` turns one webhook event into an identity,
a customer, an open conversation and a message, in one transaction. Before this
existed the inbound path terminated in `meta_webhook_events`: nothing wrote
`conversations` or `messages`, so the inbox was structurally empty in every
environment. A customer created this way has no `created_by` — nobody made
them — and is distinguished by `source`. One open conversation per customer per
channel is enforced by a partial unique index rather than by the handler, since
the relay is concurrent per workspace.

**The turn.** Only a newly projected message runs one; a duplicate or a delivery
receipt has nothing new to answer. `runTurn` executes the twelve steps against
ports that are now durable: `turn_records` provides deduplication and send
refs, `conversations.owner` and the entitlement check provide policy, and the
composed reply is persisted at `prepared` before anything could send it.

**Sending, which does not happen.** `send` authorises through the live-send gate
and stops. A sandbox connection, a closed environment gate, or a recipient
outside the allowlist all leave the reply at `prepared` — composed, validated,
stored, undelivered. That is the intended resting state. If every gate is open
the port throws, because there is no outbound adapter and a port that returned
quietly would make a build without one indistinguishable from a working one.

Failure has a single route. A provider that is down, a model that is
unconfigured, a credential that will not decrypt and a model that asked for a
person all produce an empty draft, which fails validation and resolves to a
handoff that flags the conversation for review. Configuration is therefore not
a precondition for running the pipeline: an unconfigured workspace stores its
customers' messages and escalates them to a human, which is correct rather than
degraded.

## Durable automation engine

Immutable versions and a validated state machine separate configuration from
run state. Trusted provider events alone update service windows. The send policy
runs immediately before every fake or future live send; AI and browser input
cannot override authority.

Run steps carry bounded attempts and availability times. Idempotency is reserved
before provider execution, including `sent_unknown` for crash recovery. Human
takeover pauses a conversation until explicit resume; dead letters require
controlled recovery.

## Prompt 8R production boundaries

Trusted workspace resolution now includes membership role. Viewer is read-only,
Operator may mutate CRM/automations, and Owner/Admin alone may change settings,
credentials and provider connections. Role checks run both in RLS and before
any service-role write.

Authentication throttling uses a server HMAC of operation/IP/identity and an
atomic private Postgres window in production. Raw identifiers are not stored.
Memory limiting remains a deterministic local adapter only.

CRM CSV import validates the complete file before one service-role database
function creates customers, contacts, timeline, audit and job result. Its inner
subtransaction rolls back all customer rows on any invalid row.

The Inngest endpoint registers three bounded functions: transactional Meta
outbox relay, trusted webhook processing and expired private export/auth-limit
cleanup. SDK types are isolated behind a narrow runtime compatibility boundary
because Inngest 4.13 declarations conflict with strict optional-property
checking; application code remains fully strict.

Two additional recipes share the same policy engine:
`WHATSAPP_CONSENTED_FOLLOWUP_REMINDER` permits one approved template only with
trusted schedule, consent and opt-in; `CROSS_CHANNEL_AFTER_HOURS_ESCALATION`
creates human review and explicitly sends nothing across channels.

## Prompt 10 V1 experience

Supabase remains the database/Auth/Storage target. Profile locale/theme and
bounded onboarding drafts are additive columns in migration
`20260729180000_v1_experience.sql`.

The document boundary resolves `en`, `tr` or `fa`, applies true Persian RTL and
sets Light/Dark/System before first paint. Signal Mirror semantic tokens replace
route-specific colors while keeping dense operational surfaces opaque.

Setup is an eight-stage resumable program. Drafts contain no credentials;
trusted manager routes apply workspace defaults, profile fields, structured FAQ
and price items, AI policy and readiness state idempotently.

The V1 route set adds operational Analytics, a five-recipe Gallery and a
distinct Test Center. Meta adapters now include bounded server-side media
resolution and WhatsApp template inventory contracts, but no live outbound
adapter.

## Billing and trial-abuse module

`src/modules/billing/` owns the trial/subscription state machine behind an
application-owned `PaymentProvider` interface; a deterministic fake adapter
is the dev/test default, PayTR is the first real adapter, and provider SDK
types stop at the adapter exactly like Meta and AI. Card registration follows
the same signed, single-use, workspace-bound callback-state pattern as Meta
OAuth (`billing_callback_nonces`, consumed exactly once via a guarded SQL
update); provider tokens are stored through the same AES-256-GCM envelope
seam used for Meta tokens and AI BYOK keys.

Trial eligibility is deduped by an HMAC-only, append-only ledger
(`private.trial_fraud_signals`) keyed by the payment provider's card-token
fingerprint rather than email, following the same private-schema,
service-role-only pattern as `private.auth_rate_limits`; unlike a rate limit
this ledger never expires. `resolveEntitledWorkspace` wraps
`resolveTrustedWorkspace` with a subscription-status check and is used by the
CRM, automations, inbox and Meta-connection runtimes; billing itself and the
dashboard overview stay on the plain resolver so a blocked workspace can
still reach `/settings/billing` to fix payment. PayTR webhooks follow the
verified-payload → durable outbox → Inngest-cron-relay → per-workspace
concurrency-limited consumer shape used for Meta webhooks; an ambiguous
charge outcome is recorded as `charge_unknown` and never auto-retried, per
the same uncertain-persistence rule as provider sends.
