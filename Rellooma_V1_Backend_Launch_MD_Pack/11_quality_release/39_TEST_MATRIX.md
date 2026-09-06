# V1 Test Matrix

**Source page:** 36

| Layer | Mandatory cases |
|---|---|
| Unit | RCOS priority, scoring, eligibility, usage counters, entitlement evaluator, state transitions |
| Integration | Meta normalize/send, Paddle projectors, AI provider adapters, RAG, Resend, storage |
| DB/RLS | cross-workspace denial, roles, storage paths, indexes/query plans |
| E2E App | auth/onboarding/inbox/CRM/automation/analytics/integrations/settings/billing/usage/support |
| E2E Web | locale pages, forms, attribution handoff, demo/pilot/access, pricing truth |
| AI Golden Set | ≥100 scenarios per priority vertical over time: typo, multi-intent, price, objection, angry, human request, contradictions |
| AI Safety | ungrounded money/time/status/booking cannot send; tool bypass denied |
| Idempotency | duplicate Meta/Paddle/Resend/job cannot duplicate message/action/usage/entitlement |
| Trial | starts once, exact expiry, no auto-charge, server quota, grace/suspend/delete |
| Backup | schema/RLS/storage/tombstone/sample workspace restore |
| Performance | load, burst, soak, noisy-neighbor, provider failure |
| Visual/A11y | EN/TR/FA × light/dark × desktop/mobile; keyboard; 200% zoom; reduced motion; RTL; overflow |
| Security | auth abuse, forged workspace, spoofed webhook, upload abuse, secret exposure, unsafe redirect |
