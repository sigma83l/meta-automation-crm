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

Prompt 0 implements only the shell, contracts, deterministic adapters, and
health surface. The storage, auth, job, and real provider implementations arrive
in later gated prompts.

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

Prompt 0 documents this invariant but does not claim database enforcement.
Prompt 1 must prove it against fresh migrations and Storage policies.

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
