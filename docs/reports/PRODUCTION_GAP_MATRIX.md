# Production Gap Matrix

Date opened: 2026-07-29  
Baseline: `v0.1.0-rc.1` (`3d264f115e248e6f8602a76b0ad5c7687da6cf59`)

`LOCAL` means the gap can be closed and proven without an owner account.
`EXTERNAL` means completion needs an approved identity, plan, payment, legal
acceptance, domain, or provider asset.

| Area                     | RC baseline                                  | Required Prompt 8R disposition                                                     | Class            |
| ------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------- |
| GitHub source control    | No remote                                    | Private approved-owner repository, protected branch and CI                         | EXTERNAL         |
| Vercel                   | Authenticated personal team; plan not proven | Commercially eligible team before hosted production/load work                      | EXTERNAL         |
| Supabase hosted          | Local stack only                             | Approved Pro project/region, migrations, backups and restore proof                 | EXTERNAL         |
| Inngest hosted           | Contracts only                               | Register signed handlers, retries, cleanup schedules and verify hosted execution   | LOCAL + EXTERNAL |
| Production environment   | Names documented                             | Fail-fast schema, mode gates, URL/callback validation and environment matrix       | LOCAL            |
| Auth abuse controls      | Per-process limiter                          | Shared database limiter in production; deterministic memory limiter for tests only | LOCAL            |
| Signup posture           | Public signup contract                       | Configurable self-service/invite-only production posture                           | LOCAL            |
| Authorization            | Owner-only membership                        | Explicit owner/admin/operator/viewer policy and tests                              | LOCAL            |
| Security headers         | Baseline headers                             | CSP, HSTS in production, COOP and explicit cache policy                            | LOCAL            |
| CRM ingestion            | Create/edit only                             | Safe CSV import with limits, validation, preview/result and audit                  | LOCAL            |
| Automation recipes       | Three lead collectors                        | Add consented WhatsApp reminder and cross-channel escalation recipes               | LOCAL            |
| Durable jobs             | Adapter contract                             | Concrete signed Inngest endpoint/functions with safe no-send defaults              | LOCAL            |
| Retention/export cleanup | Policy fields only                           | Workspace-scoped cleanup functions, schedule contract and dry-run/runbook          | LOCAL            |
| Real Meta operations     | Sandbox only                                 | OAuth/assets/App Review/live pilot                                                 | EXTERNAL         |
| Real AI operations       | Deterministic default                        | Paid platform/BYOK connectivity verification                                       | EXTERNAL         |
| Observability            | Health + safe errors                         | Structured event schema, readiness, SLOs, alerts and incident procedures           | LOCAL + EXTERNAL |
| Backup/restore           | Not run                                      | Reversible scripts/runbook locally; hosted PITR/restore drill                      | LOCAL + EXTERNAL |
| Capacity proof           | 20-workspace synthetic integration           | Local model plus hosted panel/conversation profiles for 1,000 users                | LOCAL + EXTERNAL |
| UX/accessibility         | Prompt 6 E2E baseline                        | New recipes/import/roles states and full viewport/accessibility regression         | LOCAL            |
| Operations handoff       | RC docs                                      | Access matrix, environment matrix, operations and owner guides                     | LOCAL            |
| Public production        | Not deployed                                 | Privacy/terms/deletion URLs, domain/DNS, approvals and explicit activation         | EXTERNAL         |

## Gate rules

- No item moves to `READY` on account authentication alone.
- No hosted load test runs on an unverified or Hobby Vercel plan.
- No external project, billing, legal, DNS, destructive migration, or live
  provider action occurs by inference.
- Local completion continues while external rows remain blocked.
- Every remaining external row is consolidated into one owner access packet
  after the local release-candidate gate passes.
