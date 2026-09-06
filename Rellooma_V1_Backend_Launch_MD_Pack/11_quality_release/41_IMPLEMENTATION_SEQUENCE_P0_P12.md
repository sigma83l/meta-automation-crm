# Developer Implementation Sequence — P0 to P12

**Source page:** 38

| Phase | Deliverable | Do not advance until |
|---|---|---|
| P0 Baseline | repo map, env/provider inventory, schema diff, UI route contract map | current truth recorded |
| P1 Data/RLS | migrations, indexes, storage policies, audit base | RLS tests pass |
| P2 Auth/Account | workspace resolver, RBAC, onboarding/trial state | E2E auth/provisioning pass |
| P3 Meta Ingress | connections, durable webhook path, normalized events | duplicate/order/reconnect tests pass |
| P4 RCOS/AI | context compiler, router, RAG, validator, tool layer | golden-set + grounding pass |
| P5 CRM/Automation | memory, state, NBA, follow-up, handoff, booking | verified outcome traces pass |
| P6 Billing/Usage | Paddle, entitlements, meter, trial jobs | webhook/reconcile/cap tests pass |
| P7 Analytics/Growth | event taxonomy, attribution, read models, site backend | PII boundary + funnel events pass |
| P8 Email/Support | Resend/Auth SMTP/tickets | delivery + recovery + ticket flow pass |
| P9 Performance/Security | concurrency, load, backup, alerts, hardening | targets + restore + security pass |
| P10 UI Binding | replace mocks with real contracts without redesign | all routes/states pass |
| P11 RC/Pilot | protected exact SHA + allowlisted live | owner acceptance + no P0/P1 |
| P12 Launch | production promotion + smoke + monitor | post-launch stable |
