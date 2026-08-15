# V1 System Topology

**Source page:** 4

## Logical topology

`rellooma.com → app.rellooma.com → Server/API Boundary → Postgres + RLS → Providers`

### Surfaces

| Surface | Role | Backend contract |
|---|---|---|
| `rellooma.com` | Public marketing / vertical / use-case / demo / access | claim registry, attribution, forms, locale state, demo/pilot handoff |
| `app.rellooma.com` | Authenticated workspace product | session/workspace resolver, read models, mutations, event/realtime refresh |
| `api.rellooma.com` | Public/service API only if repository actually uses it | Do not create unnecessary network hop; same-origin app API is valid V1 |
| `help.rellooma.com` | Support/how-to | docs + contextual links + ticket creation |
| `docs.rellooma.com` | Developer API/webhook docs after readiness | versioned docs from real contracts |
| `status.rellooma.com` | Incident transparency | independent operational surface |
| `notify.rellooma.com` | Transactional email | auth/security/billing/support/notifications |
| `news.rellooma.com` | Marketing/lifecycle email | consent-controlled only |
| `reply.rellooma.com` | Optional inbound support replies | verified webhook → ticket thread correlation |

## Recommended V1 architecture

A modular monolith is preferred:

- Next.js or current established runtime;
- tenant-scoped Postgres/RLS;
- private object storage;
- durable background jobs;
- provider adapters;
- separate site/app deployments allowed if already established;
- one logical identity/workspace/subscription authority.
