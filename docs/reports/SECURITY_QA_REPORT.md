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

## Current gate

Local unit/database/integration evidence is passing. Full E2E, accessibility,
production build, bundle, secret, audit and final diff review are rerun before
this report is closed.

No unresolved local Critical or High finding is currently known. Hosted
penetration, provider, backup and production evidence remain external.

Status: **IN_PROGRESS_LOCAL_QA**
