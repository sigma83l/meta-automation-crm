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
