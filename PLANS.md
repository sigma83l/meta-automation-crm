# Staged Production Plan

Run one stage at a time. Continue only after the prior report is accepted as
`PASS`, or its only remaining item is explicitly `BLOCKED_EXTERNAL`.

1. **Prompt 0 — Foundation:** independent repo, donor audit, contracts, sandbox,
   tests, CI, and local checkpoint.
2. **Prompt 1 — Identity and isolation (implemented):** Supabase auth, atomic
   workspace creation, RLS, private Storage, and cross-tenant denial tests.
3. **Prompt 2 — CRM and export (implemented):** customers, conversations,
   private media, Excel, and complete ZIP.
4. **Prompt 3 — Business knowledge and AI (implemented):** structured knowledge,
   paid default, encrypted BYOK, privacy gates.
5. **Prompt 4 — Meta connections (implemented locally):** OAuth/embedded signup
   contracts, verified webhooks, deduplication, and complete sandbox behavior.
6. **Prompt 5 — Automation engine:** durable state machine, policy-before-send,
   idempotency, retries, and three recipes.
7. **Prompt 6 — Owner experience:** onboarding, responsive panel, recovery
   states, accessibility, and full E2E journeys.
8. **Prompt 7 — Release candidate:** security, load, reliability, and release
   evidence with zero unresolved Critical or High findings.
9. **Prompt 8 — Approved infrastructure:** client-owned cloud resources,
   Preview, explicit Production approval, deployment, smoke tests, and handoff.
