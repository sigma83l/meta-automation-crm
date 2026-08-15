# Backend Module Boundaries

**Source pages:** 5–6

| Module | Responsibilities |
|---|---|
| `auth` | session, verification, recovery, MFA readiness |
| `workspaces` | membership, RBAC, settings, onboarding |
| `contacts` | identity resolution, dedupe, contact facts |
| `conversations` | threads, messages, attachments, ownership |
| `crm` | lifecycle, lead status, score, opportunity, timeline |
| `policy` | consent, channel eligibility, send/action permissions |
| `ai` | router, context, RAG, structured output, validator |
| `automation` | triggers, steps, runs, actions, outbox |
| `integrations.meta` | IG/WhatsApp connect, webhooks, send, health |
| `billing` | Paddle customer/subscription/transaction projection |
| `usage` | MAC, AI reply, action, storage, seat metering |
| `analytics` | first-party events, read models, funnels, retention |
| `growth` | attribution, audience state, content/partner linkage |
| `notifications` | transactional email, in-app alerts |
| `support` | tickets, threads, attachments, SLA |
| `audit` | admin/security/action history |

## Boundary rule

UI components may import typed client/service facades. They must **not** import provider SDKs, service-role DB access, or secrets. Provider SDKs and privileged DB operations stay server-side.
