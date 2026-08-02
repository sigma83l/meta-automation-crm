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
6. **Prompt 5 — Automation engine (implemented):** durable state machine,
   policy-before-send, idempotency, retries, and three recipes.
7. **Prompt 6 — Owner experience (implemented):** resumable onboarding,
   seven-step recipe builder, responsive owner panel, recovery states,
   accessibility, RTL readiness, and full E2E journeys.
8. **Prompt 7 — Release candidate (implemented locally):** security, load,
   reliability, dependency hardening, and release evidence with zero unresolved
   Critical or High findings.
9. **Prompt 8R — Autonomous production completion (implemented locally):** recover the RC,
   close every independent production gap, add two policy-safe recipes, shared
   abuse controls, roles, CRM import, durable handlers, operations/load
   artifacts, and a full local QA checkpoint. Then stop once with one owner
   access packet if GitHub, commercial Vercel, Supabase, Inngest, Meta, DNS or
   legal gates remain.
10. **Prompt 10 — V1/Signal Mirror (active):** preserve Supabase/security,
    complete the eight-stage setup, en/tr/fa, RTL, Light/Dark/System, V1 route
    set, provider contracts, private GitHub/CI and all independent QA. Stop at
    one real-value packet.
11. **Hosted staging and production (owner-gated):** provision only the exact
    approved resources, run hosted security/1,000-user/backup/live-pilot gates,
    obtain explicit production approval, deploy, smoke test and hand off.
