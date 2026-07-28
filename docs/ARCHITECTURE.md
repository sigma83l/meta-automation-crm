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
record, and creates one `meta/webhook.received` outbox row. Provider media URLs
are transient hints; background download uses the `ProviderMediaDownloader`
interface and private Storage later.

## Durable automation engine

Immutable versions and a validated state machine separate configuration from
run state. Trusted provider events alone update service windows. The send policy
runs immediately before every fake or future live send; AI and browser input
cannot override authority.

Run steps carry bounded attempts and availability times. Idempotency is reserved
before provider execution, including `sent_unknown` for crash recovery. Human
takeover pauses a conversation until explicit resume; dead letters require
controlled recovery.
