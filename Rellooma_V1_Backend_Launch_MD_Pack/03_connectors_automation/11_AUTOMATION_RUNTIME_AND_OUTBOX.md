# Durable Automation Runtime and Action Execution

**Source page:** 18

## Definition and run model

- Automation definitions are immutable versions.
- Publish creates a versioned snapshot.
- `automation_runs` + `step_runs` record execution.
- Every side effect has an idempotency key.
- Triggers use normalized event schemas.
- Allowed steps: condition, AI decision, CRM write, task, wait, send, booking, handoff — strict allowlist.

## Side-effect safety

- Use transactional outbox for uncertain sends/actions before provider call.
- Retry transient failures only.
- Completed steps are not repeated.
- Maintain per-conversation ordering.
- Workspace-level emergency pause + automation-level pause.

## Test Center

- Synthetic dry-run.
- Show action trace and why would-send / would-block.
- Never touches live provider by default.
- Publish gate checks connection, knowledge, policy, permissions, trial/entitlement, and test pass.

## Queue classes

- `inbound-critical`
- `ai-reply`
- `tool-action`
- `follow-up`
- `campaign-bulk` — disabled in V1 trial.

Use per-workspace concurrency to prevent noisy-neighbor behavior and provider throttling.
