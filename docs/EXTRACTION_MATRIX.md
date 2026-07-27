# Donor Extraction Matrix

## Provenance rule

No repository-level transferable license was found in either donor. The
canonical MetricOne instructions also prohibit cross-repository source copying
without an approved contract. Therefore Prompt 0 copies no source or asset.
Paths below are audit evidence only.

## metric-App

Canonical path:
`/Users/zekigurselozbulak/Desktop/mani/project/MetricOne/repos/metric-App`

| Candidate                                        | Source evidence                                                                    | Class                 | Target contract                                                       | Hidden dependencies / decision                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Shell, navigation, compact cards and form states | `frontend/src/portals`, `frontend/src/shared/components`, `frontend/src/index.css` | `ADAPT_UI`            | Original responsive owner shell with semantic states                  | Tailwind, React Router, Framer Motion, locked MetricOne branding; use behavior only     |
| Identity/workspace vocabulary                    | `backend/src/contracts/v1`                                                         | `EXTRACT_BY_CONTRACT` | Server-resolved workspace authority and deny-by-default authorization | Existing Agency/Client bridge is incomplete; do not reuse roles or code                 |
| Auth/session patterns                            | `backend/src/controllers/auth.controller.js`, middleware and token modules         | `EXTRACT_BY_CONTRACT` | Supabase SSR sessions plus app-owned workspace resolution             | JWT/Prisma/Express stack differs; Prompt 1 implements fresh                             |
| WhatsApp HMAC and safe-send behavior             | `backend/src/services/whatsapp`                                                    | `REWRITE_SMALL`       | Raw-body signature verification and a fail-closed outbound gate       | Express raw body, logger, environment flags; no source copied                           |
| AI structured reply and guardrails               | `backend/src/services/agent`, `backend/src/services/ai`                            | `EXTRACT_BY_CONTRACT` | Strict application-owned reply schema and provider seam               | Current code uses raw fetch, Prisma, DOMPurify, Gemini fallback; Prompt 3 designs fresh |
| Scheduler                                        | `backend/src/jobs/scheduler.js`                                                    | `REJECT`              | Inngest durable workflow interface                                    | `node-cron`, Prisma, mail, Redis, analytics and FX assumptions are unrelated            |
| MetricOne colors, fonts, mascot, brand assets    | frontend and brand docs                                                            | `REJECT`              | None                                                                  | Protected MetricOne identity; unrelated product                                         |
| Prisma schema/migrations and seed users          | `backend/prisma`                                                                   | `REJECT`              | Fresh Supabase migrations only                                        | Different data model and unsafe donor data assumptions                                  |

## mani-marketing-dashboard

Canonical path:
`/Users/zekigurselozbulak/Desktop/mani/project/MetricOne/migration-sources/mani-marketing-dashboard`

| Candidate                                                              | Source evidence                                                                   | Class                 | Target contract                                                       | Hidden dependencies / decision                                                         |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Multi-business ownership model                                         | `docs/multi-business-architecture.md`, tenant modules                             | `EXTRACT_BY_CONTRACT` | Workspace column, RLS deny-by-default, trusted membership resolution  | Donor still contains legacy global tables and bootstrap-domain fallback; reject both   |
| Account/session behavior                                               | `src/lib/account`, `src/lib/auth.ts`, auth docs                                   | `EXTRACT_BY_CONTRACT` | Transactional signup and server-managed Supabase session              | Donor has transition cookies, shared-password legacy and Prisma; Prompt 1 reimplements |
| WhatsApp webhook verification                                          | `src/lib/whatsapp/signature.ts`, webhook routes                                   | `REWRITE_SMALL`       | App-secret HMAC over raw body, timing-safe compare, fast ACK          | Credential vault, Prisma and provider account routing must be redesigned               |
| WhatsApp rules, drafts and test center                                 | `src/lib/whatsapp-automation`, `src/lib/whatsapp-ai`, app routes                  | `EXTRACT_BY_CONTRACT` | Deterministic state/policy engine and synthetic evidence              | Product catalog, Smarto pricing and existing migrations are rejected                   |
| Instagram comment safety                                               | `src/lib/instagram`, `src/components/omnichannel/InstagramCommentsTestCenter.tsx` | `EXTRACT_BY_CONTRACT` | Private-reply eligibility, opt-out, pause, approval and sandbox tests | Prisma, account verification and credential-vault dependencies arrive later            |
| Omnichannel CRM/conversations                                          | `src/lib/omnichannel`, analytics conversation routes                              | `EXTRACT_BY_CONTRACT` | Workspace-scoped normalized customer/conversation/message model       | Donor models and migration history are not portable                                    |
| App shell and operational state layout                                 | `src/components/AppShell.tsx`, CSS module                                         | `ADAPT_UI`            | Small owner navigation and visible safe-mode state                    | Large unrelated commerce/admin navigation and Smarto branding rejected                 |
| Health/readiness contract                                              | `src/services/system/healthService.ts`                                            | `REWRITE_SMALL`       | Non-secret health payload with configured/pending states              | Donor queries DB, logs and marketplace integrations; foundation stays side-effect free |
| Cron and queue behavior                                                | cron routes and growth automation modules                                         | `REJECT`              | Inngest durable job adapter                                           | Vercel cron, marketplace and AI-growth assumptions are unrelated                       |
| Brand assets, env files, encrypted vault rows, customer/analytics data | `public`, `.env*`, DB and migration history                                       | `REJECT`              | None                                                                  | Secret, PII, ownership, licensing and unrelated-business risk                          |

## Security findings excluded from the target

- Client-supplied workspace selection cannot establish authority.
- No email-domain or first-tenant fallback.
- No global business tables.
- No shared dashboard password compatibility path.
- No rule-based or free-provider fallback may process real customer data.
- No environment flag alone enables a send.
- No long-running scheduler inside a request/serverless process.
- No provider URL, raw webhook body, token, customer content, or secret in logs.
- No donor migration, seed identity, account link, or hardcoded business name.
