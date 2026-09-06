# Site + App + Backend Synchronization Matrix

**Source pages:** 22–28

| Experience | Backend modules | Core data | Provider dependency | Acceptance |
|---|---|---|---|---|
| Public locale/industry/use-case pages | growth, analytics | claim registry, content registry, attribution | none required for static truth | only verified/sandbox/planned states rendered correctly |
| Demo/Test Center | automation, ai, policy | synthetic scenario, action trace | no live provider by default | would-send/would-block trace matches policy |
| Access/Trial | auth, workspaces, billing | user, workspace, trial state, attribution | Supabase Auth, Paddle when enabled | no stale CTA/config; server-derived state |
| Onboarding | workspaces, policy, integrations | onboarding state, settings, knowledge, blockers | Meta sandbox/allowlist | resumable 8-stage state |
| Overview | analytics, integrations, tasks | overview read model | provider health read-only | recent outcome + next action + blockers accurate |
| Inbox | conversations, contacts, CRM, policy, AI | messages, contact state, eligibility, handoff | Meta send/delivery | send only when server says eligible |
| CRM | contacts, CRM, analytics | facts, lifecycle, score evidence, timeline | none required | no cross-tenant reads; explainable score/state |
| Automations | automation, policy, AI | versioned definition/run/readiness | Inngest + Meta when live | dry-run safe; publish gated |
| Analytics | analytics, usage | first-party ledger/read models | optional PostHog/GA consumer only | no raw PII in generic analytics |
| Integrations | integrations.meta | connection health/recovery | Meta | stateful health, not boolean only |
| Settings AI | ai, policy, workspaces | style/policy/config versions | AI provider | no raw prompt engineering required |
| Team | workspaces, billing | membership/roles/seat entitlement | Paddle entitlement | seat gate server-side |
| Billing | billing, usage | subscription, entitlement, portal link | Paddle | webhook/reconcile authority only |
| Support | support, notifications | ticket/thread/attachments | Resend | DB is ticket source of truth |
