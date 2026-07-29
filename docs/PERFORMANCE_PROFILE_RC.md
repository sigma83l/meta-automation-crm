# Release Candidate Synthetic Performance Profile

This is a modest local concurrency validation, not an enterprise benchmark or
production SLA.

## Environment

- macOS 26.5.2 (25F84), Apple M4, 16 GiB memory
- Node.js 24.16.0
- pnpm 11.17.0
- local Supabase CLI/Postgres containers
- deterministic synthetic identities and content only

## Exact workload

- 20 isolated workspaces and 20 active sandbox WhatsApp connections.
- 10 unique inbound events per workspace.
- One simultaneous provider retry for each event: 400 ingestion calls total,
  200 unique and 200 duplicates.
- Five-millisecond deterministic provider-delay simulation per call.
- Global harness limit 8; observed maximum 8.
- Observed per-workspace maximum 2, below the durable contract limit of 4.
- 20 workspace-scoped CRM XLSX/ZIP builds, bounded to 4 concurrent jobs.
- One outbound idempotency key per workspace reserved twice and finalized once.

## Result

- 200 accepted events and 200 duplicate results.
- Exactly 200 normalized database events and 200 outbox rows.
- Every workspace owned exactly its 10 expected provider-event IDs.
- No cross-tenant event or manifest mixing.
- All 20 export manifests retained their trusted workspace.
- Every duplicate outbound reservation was denied; no duplicate attempt became
  sendable.
- The isolated load plus auth integration run completed in 2.68 seconds; the
  subsequent complete six-file integration run completed in 2.69 seconds on
  this machine.

The harness validates local concurrency, atomic deduplication and tenant
partitioning. It does not measure Meta, AI, hosted Inngest, network latency,
Vercel scaling, hosted Postgres capacity or large production exports.
