# Final App UI → Backend Contracts

**Source page:** 24

| Route/surface | Backend dependency | UI truth |
|---|---|---|
| `/auth/*` | Supabase Auth, redirect allowlist, Turnstile/rate limit | session/verified/recovery states |
| `/onboarding` | workspace settings, connections, knowledge, policy, Test Center | 8-stage state + blockers + resume |
| `/overview` | overview read model + integration health + task blockers | readiness, recent outcome, next action |
| `/inbox` | conversations/messages/contact revenue state/handoff/send policy | queue/list + thread + context + composer eligibility |
| `/crm` | contacts/opportunities/search/filter/import/export | contact list + lifecycle/status/owner |
| `/crm/[id]` | contact facts, timeline, conversations, score evidence, tasks, appointments | complete customer memory + next action |
| `/automations` | definitions/versions/readiness/test status | recipe-first list + create |
| `/automations/[id]` | trigger/steps/policy/test/publish/runs | builder + validation + run history |
| `/automations/test-center` | synthetic RCOS/action simulation | trace, why, would-send/would-block |
| `/analytics` | operational read models only | response/qualification/outcome/handoff/follow-up |
| `/integrations` | connection/provider health/reconnect | stateful health + recovery |
| `/settings/business` | workspace settings + knowledge/profile | versioned config/publish snapshot |
| `/settings/ai` | style/policy/permissions/router safe controls | no raw prompt engineering required |
| `/settings/team` | memberships/invites/roles/seat entitlement | server role + seat gate |
| `/settings/billing` | subscription + entitlements + provider portal links | owner-only billing projection |
| `/usage` | usage aggregates + thresholds | MAC/AI replies/actions/media/seats; no P&L |
| `/support` | ticket CRUD + timeline + attachments | contextual support/status |
