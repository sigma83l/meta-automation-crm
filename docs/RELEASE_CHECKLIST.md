# Release Checklist

## Local candidate

- [x] Clean install from lockfile.
- [x] Formatting, lint, strict typecheck, unit and integration tests pass.
- [x] Production build and E2E pass on supported viewports.
- [x] Secret scan and full/production dependency audits pass.
- [x] Fresh migrations validate from zero and rollback notes are current.
- [x] Cross-workspace database and Storage denial tests pass.
- [x] Provider signature, replay, idempotency, policy and retry tests pass.
- [x] Export/media corruption and injection tests pass.
- [x] Accessibility and responsive journeys pass.
- [x] Zero unresolved Critical or High security findings.

## External readiness

- [ ] Client owns GitHub, Vercel, Supabase, Inngest, Meta, AI and domain assets.
- [ ] Billing, region, retention, backups and rollback are approved.
- [ ] Privacy policy, terms and deletion/retention process are published.
- [ ] Meta Business Verification, App Review and Advanced Access status recorded.
- [ ] Preview passes two-workspace synthetic smoke tests.
- [ ] Exact SHA receives explicit Production approval.
- [ ] Production source matches the approved SHA and rollback target is verified.

The local Release Candidate satisfies the local list only. Unchecked external
items remain Prompt 8 gates and prevent a production-readiness claim.
