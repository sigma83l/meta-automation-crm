# Prompt 8R Security QA Report

Date opened: 2026-07-29

## Fixed findings

| Severity | Finding                                                              | Root cause                                          | Correction/regression                                                        |
| -------- | -------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| High     | Per-process auth throttling would not protect multiple instances     | memory-only adapter                                 | atomic HMAC-keyed Postgres limiter; pgTAP and two-client integration         |
| High     | Future Viewer role could cross a service-role write boundary         | trusted workspace lacked role authority             | trusted role resolution plus manager/operator assertions and RLS integration |
| High     | CRM/business/storage mutations treated every active member as writer | membership was binary                               | role-aware RLS and Storage policies; Viewer denial proof                     |
| Medium   | Additional workspace members could not resolve a workspace           | onboarding join incorrectly required member user ID | workspace-scoped onboarding resolver and Viewer membership test              |
| Medium   | Automation setup ignored configured questions                        | hardcoded Name/Email rows                           | normalized configured question rows                                          |
| Medium   | Webhook outbox and cleanup had no registered durable handlers        | foundation-only contract                            | three concrete Inngest v4 handlers and endpoint                              |
| Medium   | CRM lacked controlled bulk ingestion                                 | no import boundary                                  | 1 MiB/500-row parser, atomic server RPC, audit job, cross-tenant test        |
| Medium   | Security headers omitted CSP/HSTS/COOP                               | foundation header set                               | explicit CSP, production-only HSTS and header tests                          |

## Final local evidence

- frozen pnpm install: pass;
- format/lint/strict typecheck: pass;
- unit: 13 files / 73 tests pass (run repeatedly after fixes);
- migration from zero: seven migrations pass;
- database/RLS/Storage: six files / 109 assertions pass;
- integration: seven files / 26 tests pass;
- full E2E/accessibility/viewport matrix: 21 pass / one intentional duplicate
  viewport skip;
- final Meta sandbox E2E after live adapter: one pass;
- production build: 32 routes pass;
- client bundle scan: 23 assets pass;
- secret scan: pass;
- production dependency audit: zero known vulnerabilities;
- load profile syntax: pass;
- local backup/restore drill: pass.

No unresolved local Critical or High finding is known. Hosted penetration,
1,000-user, provider and production evidence remain external.

Status: **PASS_LOCAL / HOSTED_NOT_RUN**
