# Architecture Decisions

## D-001 — Independent repository

The product is created at a new Desktop path with no Git remote or donor
history. Donors remain read-only evidence.

## D-002 — No source transfer

No transferable donor license or approved copy contract was found. Reusable
behavior is recorded as contracts and reimplemented; brand assets, migrations,
data, and source are rejected.

## D-003 — Next.js modular monolith

Use Next.js App Router and strict TypeScript in one deployable repository.
Business modules own small interfaces. Provider, database, and durable-job
adapters sit at explicit seams.

## D-004 — Supabase and Inngest contracts first

Prompt 0 declares Auth/Postgres/private Storage and durable-event contracts
without provisioning accounts or applying migrations. Fakes keep local tests
independent from external accounts.

## D-005 — Fail-closed live operations

Sandbox is the default. Live sends require environment enablement, explicit
approval, an allowlisted recipient, current provider policy, and a real adapter.
The foundation deliberately has no real adapter.

## D-006 — Original operational UI

Adapt the donor’s information hierarchy—control rail, compact cards, visible
safe state—without copying its code, tokens, branding, charts, or product
navigation. The two-channel signal lane is the foundation’s visual signature.

## D-007 — Locked, exact dependencies

Use pnpm with exact dependency versions and a committed lockfile. Node 22 is the
CI baseline; locally supported Node versions are constrained in `package.json`.

## D-008 — Database transaction owns signup provisioning

An `auth.users` trigger creates the entire initial workspace graph in one
Postgres transaction. Application compensation logic is rejected because it can
leave partial tenants after a crash.

## D-009 — Membership is the sole tenant authority

The session establishes identity; active membership plus active profile and
workspace establish authority. Client workspace IDs only narrow an already
authorized result. RLS and Storage use the same predicate.

## D-010 — Confirmation initially disabled

`ENABLE_EMAIL_CONFIRMATION=false` matches the requested launch behavior.
Schema, callback and UI support enabling it later. This accepts unverified-email
risk and does not remove the production SMTP requirement for recovery.

## D-011 — CRM relationships enforce workspace twice

Every business row stores `workspace_id`; composite foreign keys prevent
cross-workspace relationship forgery and forced RLS checks active membership.

## D-012 — Private files are content-verified

Browser MIME, extension and filename are untrusted. Actual magic bytes, size,
safe generated name, checksum and private metadata are required.

## D-013 — Exports are scoped jobs

One, selected, filtered and full-workspace exports share one collector
interface. Synchronous generation is capped; large work uses the durable event
seam. ZIP paths are generated, workbook formulas neutralized, secret-shaped
keys removed and downloads expire.

## D-014 — Structured knowledge before RAG

V1 uses profiles, FAQs, and price items. Document ingestion and vector retrieval
wait for explicit authorization, provenance, retention, and evaluation designs.

## D-015 — AI privacy mode is an invariant

Free Gemini accepts explicit synthetic Demo input only. Paid/BYOK failures never
fall back across that boundary. Strict schema and policy checks run before a
reply can become eligible for sending.

## D-016 — BYOK uses authenticated envelopes

Keys use server-only AES-256-GCM with random IV, auth tag, and version. Members
see masked metadata; a service-role adapter receives an already trusted
workspace and owns store, test, rotate, and delete.

## D-017 — Provider account mapping is tenant authority

Meta payloads never select a workspace. A verified request supplies a provider
account identifier that resolves through a stored active connection. The
database performs mapping, state check, deduplication, persistence, and outbox
creation atomically.

## D-018 — Webhook ACK uses a durable outbox seam

The request path verifies, minimally normalizes, and writes one transactional
outbox row. Provider-specific work and media downloads are background concerns.
This preserves quick acknowledgements without losing accepted events.

## D-019 — Production auth limits are shared and pseudonymous

Production rejects memory mode. A server HMAC removes raw identity/IP values
before one atomic private Postgres window consumes the attempt.

## D-020 — Roles are enforced twice

Viewer, Operator, Admin and Owner authorization is represented in RLS/Storage
policies and repeated before service-role writes. Client UI state is helpful but
never authoritative.

## D-021 — CRM import is all-or-nothing

The server validates the complete bounded CSV and passes a trusted workspace to
one database function. A failed row rolls back customer/contact/timeline/audit
inserts and records only a safe job failure.

## D-022 — Load proof requires commercial staging

Tracked 1,000-user profiles do not become evidence until they run against an
isolated, monitored, commercially eligible hosted environment. Vercel Hobby or
unverified plans are an explicit stop.

## D-023 — Preserve Supabase for V1

Supabase Auth, Postgres, forced RLS and private Storage already pass isolation
tests. Prompt 10's database decision therefore preserves the accepted stack;
Neon is not a variable substitution for Auth/Storage and is not introduced.

## D-024 — Locale and theme are owner preferences

UI locale/theme live on the profile and an SSR-readable SameSite cookie.
Customer-message languages remain business policy. Persian sets document-level
RTL; System theme resolves before first paint.

## D-025 — Invite-only hosted posture

Prompt 10 hosted environments remain invite-only unless email verification
delivery and abuse controls are both proven. Production parsing rejects
self-service signup without that evidence.

## D-026 — Prompt 10 is no-send

Production preflight for this release requires Meta Sandbox and
`LIVE_PROVIDER_SEND_ENABLED=false`. Real provider values and allowlisted pilots
belong to Prompt 11.
