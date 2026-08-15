# API / Server Route Contracts

**Source page:** 27

Endpoint names are illustrative. Reconcile with the current route tree and do not create duplicates.

| Contract | Illustrative endpoint |
|---|---|
| raw/verified Meta webhook → durable event → queue | `POST /api/webhooks/meta` |
| Meta provider challenge if required | `GET /api/webhooks/meta` |
| raw Paddle signature verify → billing event → async projection | `POST /api/webhooks/paddle` |
| Resend delivery/inbound event → email/ticket event | `POST /api/webhooks/resend` |
| internal authenticated event ingest only | `POST /api/events` |
| current workspace/session projection | `GET /api/workspaces/current` |
| cursor-paginated inbox read model | `GET /api/inbox` |
| thread + customer context | `GET /api/conversations/:id` |
| policy + ownership + entitlement + provider send | `POST /api/conversations/:id/send` |
| explicit handoff | `POST /api/conversations/:id/handoff` |
| contact search/filter | `GET /api/contacts` |
| contact facts/lifecycle under RLS + audit | `GET/PATCH /api/contacts/:id` |
| synthetic automation dry-run | `POST /api/automations/:id/test` |
| publish readiness gate + version | `POST /api/automations/:id/publish` |
| analytics read models | `GET /api/analytics/*` |
| owner-only billing projection | `GET /api/billing/summary` |
| server-generated checkout params | `POST /api/billing/checkout` |
| server-generated customer portal/session link | `POST /api/billing/portal` |
| usage aggregate | `GET /api/usage` |
| validated support ticket | `POST /api/support/tickets` |
| safe public attribution capture | `POST /api/growth/attribution` |
