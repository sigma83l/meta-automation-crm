# Local test results

| Command                                | Result                                           |
| -------------------------------------- | ------------------------------------------------ |
| `corepack pnpm format:check`           | PASS                                             |
| `corepack pnpm lint`                   | PASS — zero warnings                             |
| `corepack pnpm typecheck`              | PASS                                             |
| `corepack pnpm test`                   | PASS — 87 passed, 23 environment-dependent skips |
| `corepack pnpm db:reset`               | PASS — isolated local database                   |
| `corepack pnpm test:db`                | PASS — 121 tests                                 |
| `corepack pnpm test:integration:local` | PASS — 27 tests                                  |
| `CI=1 corepack pnpm test:e2e`          | PASS — 28 passed, 2 intentional skips, 3.4 min   |
| Visual matrix within E2E               | PASS — 324 captures                              |
| `corepack pnpm build`                  | PASS — Next.js 16.2.12, 35 pages                 |
| `corepack pnpm load:check`             | PASS                                             |
| `corepack pnpm bundle:scan`            | PASS — 26 client assets                          |
| `corepack pnpm secret:scan`            | PASS                                             |
| `corepack pnpm audit:prod`             | PASS — no known vulnerabilities                  |
| `git diff --check`                     | PASS                                             |

Versions: Node 24.16.0; pnpm 11.17.0; Next.js 16.2.12; React 19.2.8; TypeScript
5.9.3; Playwright 1.62.0; Supabase CLI 2.110.0.
