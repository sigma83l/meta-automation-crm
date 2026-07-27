# Release Checklist

## Local candidate

- [ ] Clean install from lockfile.
- [ ] Formatting, lint, strict typecheck, unit and integration tests pass.
- [ ] Production build and E2E pass on supported viewports.
- [ ] Secret scan and dependency review pass.
- [ ] Fresh migrations validate from zero and rollback notes are current.
- [ ] Cross-workspace database and Storage denial tests pass.
- [ ] Provider signature, replay, idempotency, policy and retry tests pass.
- [ ] Export/media corruption and injection tests pass.
- [ ] Accessibility and responsive journeys pass.
- [ ] Zero unresolved Critical or High security findings.

## External readiness

- [ ] Client owns GitHub, Vercel, Supabase, Inngest, Meta, AI and domain assets.
- [ ] Billing, region, retention, backups and rollback are approved.
- [ ] Privacy policy, terms and deletion/retention process are published.
- [ ] Meta Business Verification, App Review and Advanced Access status recorded.
- [ ] Preview passes two-workspace synthetic smoke tests.
- [ ] Exact SHA receives explicit Production approval.
- [ ] Production source matches the approved SHA and rollback target is verified.

Prompt 0 does not satisfy the unchecked production items.
