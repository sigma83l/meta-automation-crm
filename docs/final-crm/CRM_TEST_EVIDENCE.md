# CRM test evidence

Recorded 2026-09-03 at `691f10a`. Every number below is from a run at that SHA.

## What runs

| Suite                      | Command                                             | Result                             |
| -------------------------- | --------------------------------------------------- | ---------------------------------- |
| Unit + migrations + golden | `pnpm test`                                         | 1517 passed, 31 skipped, 105 files |
| Format / lint / types      | `pnpm format:check`, `pnpm lint`, `pnpm typecheck`  | clean, zero warnings               |
| CRM E2E flows              | `pnpm test:e2e tests/e2e/crm-flows.spec.ts`         | 8 passed (Chromium)                |
| CRM visual matrix          | `pnpm test:e2e tests/e2e/crm-visual-matrix.spec.ts` | 2 passed, 54 screenshots           |

The 31 skips are the live-model golden set, which skips itself unless a real
provider is configured. That is deliberate and predates this stage.

## The pack's matrices, and where each is executed

| Matrix                    | File                                       | Cells                    |
| ------------------------- | ------------------------------------------ | ------------------------ |
| `01_MEMORY_GOLDEN_MATRIX` | `tests/golden/memory-matrix.test.ts`       | 7 + a coverage assertion |
| `02_SCORE_GOLDEN_MATRIX`  | `tests/golden/score-matrix.test.ts`        | 7 + a coverage assertion |
| `03_RBAC_MATRIX`          | `tests/migrations/crm-rbac-matrix.test.ts` | 105 + 2                  |
| `04_E2E_CRITICAL_FLOWS`   | `tests/e2e/crm-flows.spec.ts`              | 8 of 10                  |
| `05_VISUAL_MATRIX`        | `tests/e2e/crm-visual-matrix.spec.ts`      | 54 + 2 states            |

All three JSON matrices are copied out of the pack byte for byte into
`tests/golden/` and excluded from formatting. Each test compares its own case
list against the pack's file, so a case that loses its test fails the suite
rather than disappearing from it.

## The two E2E flows that are not here

Flow 4 (a human corrects an AI fact) and flow 5 (a manual follow-up through the
due queue to an outcome) have engines, unit tests and no route. There is nothing
for an operator to click, so there is no journey to drive. Driving them by
calling the repository from a test would produce a green flow for a journey
nobody can take. They are in `CRM_FUTURE_BACKLOG.md`.

## What the doubles cannot prove, and where those claims live instead

`tests/fixtures/fake-supabase.ts` reproduces PostgREST filter semantics and the
RPCs the application depends on. It has no grants, no policies and no
constraints, so three classes of claim are asserted against a real engine in
`tests/migrations/` instead:

- Row-level security and grants — `crm-rbac-matrix.test.ts`, `role-policies.test.ts`.
- Append-only tables and check constraints — `qualification-score-engine.test.ts`.
- Definer-function authority — `settle-next-action.test.ts`.

This split is what made the settlement bug findable. It had passed for weeks
against a double that could not see a missing grant.

## Known harness issue, not a product defect

`auth.spec.ts`, `owner-panel.spec.ts` and `visual-qa.spec.ts` fail on a local
machine and pass in CI. The cause is identified: a developer `.env.local` is
shaped like production, and the signup submit races React hydration - clicked
too early it performs a native GET that clears the form. `scripts/with-supabase-env.mjs`
now clears the Turnstile site key and forces self-service signup so the local
server matches CI, and `tests/e2e/support/workspace.ts` retries the two submits
that race. The three specs above still carry their own inline signup and were
left alone rather than rewritten in passing; applying the same helper is the fix.
