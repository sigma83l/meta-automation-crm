# Release Candidate Test Report

Date: 2026-07-29

Repository: `/Users/zekigurselozbulak/Desktop/meta-automation-crm`

Branch: `main`

Accepted Prompt 6 checkpoint: `2869f9e40dbdcd3e4a856069562087a9faa8e43e`

## Release test matrix

| Area                    | Evidence                                                                                    | Result |
| ----------------------- | ------------------------------------------------------------------------------------------- | ------ |
| Auth/workspace creation | signup, login, logout, refresh, recovery, disabled account and atomic rollback              | PASS   |
| Tenant isolation/IDOR   | cross-workspace read/write/search/export denial and forged hints                            | PASS   |
| RLS/private Storage     | forced RLS, grants, private list/download/sign/write denial                                 | PASS   |
| CRM/media               | create/edit/reload, identities, timeline, magic-byte MIME, filename and size policy         | PASS   |
| Excel/ZIP               | sheet/header/scope reopening, manifest consistency, formula and traversal defenses          | PASS   |
| AI/BYOK/privacy         | strict output, paid/BYOK selection, free-demo rejection, encryption and plaintext negatives | PASS   |
| Meta/webhooks           | raw HMAC, challenge, stored-account routing, replay/dedupe and safe logs                    | PASS   |
| Provider adapters       | deterministic Meta/AI/messaging fixtures and safe error mapping                             | PASS   |
| Automation              | state machine, three recipes, policy windows, takeover, retry/dead letter and idempotency   | PASS   |
| UI/accessibility        | owner journeys, XSS escaping, semantic-label smoke, focus order, RTL and viewport matrix    | PASS   |
| Deployment build        | Next.js production build and client-bundle secret scan                                      | PASS   |

## Commands and exact results

| Command                                                         | Result                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------- |
| `corepack pnpm install --frozen-lockfile`                       | PASS; pnpm 11.17.0, lockfile unchanged                        |
| `corepack pnpm format:check`                                    | PASS after formatting five new/edited files                   |
| `corepack pnpm lint`                                            | PASS                                                          |
| `corepack pnpm typecheck`                                       | PASS                                                          |
| `corepack pnpm test:unit`                                       | PASS; 9 files, 57 tests                                       |
| `corepack pnpm test:integration:local`                          | PASS; 6 files, 22 tests                                       |
| `corepack pnpm db:reset`                                        | PASS; six fresh migrations applied from zero                  |
| `corepack pnpm test:db`                                         | PASS; 5 pgTAP files, 95 assertions                            |
| reset to `20260729010000`, then `supabase migration up --local` | PASS; RC migration applied alone and all 95 assertions passed |
| `supabase db lint --local --level warning`                      | PASS; no schema errors                                        |
| `corepack pnpm test:e2e`                                        | PASS; 21 passed, 1 intentional visual-matrix project skip     |
| `corepack pnpm build`                                           | PASS; 30 App Router pages/routes generated                    |
| `corepack pnpm bundle:scan`                                     | PASS; 23 client assets, no server-secret marker               |
| `corepack pnpm secret:scan`                                     | PASS                                                          |
| `corepack pnpm audit --audit-level high`                        | PASS; no known vulnerabilities                                |
| `corepack pnpm audit:prod`                                      | PASS; no known vulnerabilities                                |

The E2E skip is not an untested viewport: `visual-qa.spec.ts` runs desktop,
tablet, mobile and RTL in Chromium and skips only the redundant Pixel project
copy. Functional journeys run in both configured projects.

## Failures found and corrected

1. Instagram attachment arrays were not parsed. The normalizer now reaches the
   array and rejects embedded provider URLs; a regression covers both.
2. A global workspace-count assertion raced concurrent tenant creation. It now
   proves the failed identity is absent, which directly tests transaction
   rollback without serial-world assumptions.
3. The full audit found vulnerable transitive `brace-expansion@1.1.16`. It is
   overridden to patched 5.0.8, with a narrow `minimatch@3.1.5` compatibility
   patch. Lint, install, audits and build prove the lock remains usable.
4. The first compatibility override exposed `expand is not a function`; the
   patch handles both historical function and patched named-export shapes.
5. Initial formatting findings in five touched files were corrected and the
   complete format gate rerun.
6. A final E2E rerun reproduced a Next.js Turbopack HMR backend panic during
   rapid authenticated navigation. Playwright now uses stable Webpack dev mode;
   all six affected journeys and then the complete 22-test matrix passed. The
   separate optimized production build continues to validate Turbopack.

No tests or assertions were removed or weakened.
