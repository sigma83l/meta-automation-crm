# Release Manifest

Candidate: `meta-automation-crm` Prompt 8R local RC

Branch: `main`

Accepted rollback SHA: `3d264f115e248e6f8602a76b0ad5c7687da6cf59`

RC identity: local annotated tag `v0.2.0-rc.1`

The exact RC commit SHA is recorded by the immutable local tag and the Prompt 7
final report. A tracked file cannot contain its own future commit hash without
changing that hash; resolve it with:

```sh
git rev-parse 'v0.2.0-rc.1^{commit}'
```

## Reproducibility

- Package manager: pnpm 11.17.0 through Corepack
- Node range: `>=22 <27`; validated with 24.16.0
- Lock SHA-256:
  `b82eaf060e9e3bedbc1ec59924caa39e0fd119b891c3624bcfe60357e82007bf`
- Latest migration: `20260729150000_production_hardening.sql`
- Test commands/results: `docs/TEST_REPORT_RC.md`
- Security findings: `docs/SECURITY_REVIEW_RC.md`
- Rollback: `docs/ROLLBACK.md`

## Feature status

| Capability                                                   | Status       | Evidence/gate                                            |
| ------------------------------------------------------------ | ------------ | -------------------------------------------------------- |
| Supabase Auth/workspace/RLS/private Storage contracts        | REAL         | local database and E2E pass                              |
| CRM, inbox data, media validation, XLSX/ZIP                  | REAL         | integrity/isolation suites pass                          |
| Business profile, structured knowledge, encrypted BYOK vault | REAL         | local contract/encryption tests pass                     |
| AI generation                                                | DEMO/PARTIAL | deterministic provider; paid external account unverified |
| Meta connections/webhooks                                    | DEMO/PARTIAL | signed/deduplicated sandbox; real OAuth blocked          |
| Five automation recipes/policy/idempotency                   | REAL locally | deterministic engine and fake E2E pass                   |
| Shared auth limiter, roles and CRM CSV import                | REAL locally | database/integration/browser denial tests pass           |
| Durable outbox/event/cleanup handlers                        | REAL locally | registered endpoint; hosted environment unverified       |
| Live Meta sends                                              | BLOCKED      | explicit deny; Meta approval/assets absent               |
| Production deployment                                        | BLOCKED      | Prompt 8 approval and client infrastructure absent       |

## Environment variable names

`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `LIVE_PROVIDER_SEND_ENABLED`,
`LIVE_TEST_RECIPIENT_ALLOWLIST`, `CREDENTIAL_ENCRYPTION_KEY`,
`PLATFORM_AI_PROVIDER`, `PLATFORM_GEMINI_API_KEY`,
`PLATFORM_OPENAI_API_KEY`, `PLATFORM_ANTHROPIC_API_KEY`,
`AI_PROVIDER_TIMEOUT_MS`, `META_APP_ID`, `META_APP_SECRET`,
`META_WEBHOOK_VERIFY_TOKEN`, `META_OAUTH_REDIRECT_URL`,
`META_GRAPH_API_VERSION`, `META_WHATSAPP_CONFIG_ID`,
`META_CONNECTION_MODE`, `ENABLE_EMAIL_CONFIRMATION`,
`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`,
`AUTH_CAPTCHA_MODE`, `AUTH_SIGNUP_MODE`, `AUTH_RATE_LIMIT_MODE`,
`AUTH_RATE_LIMIT_HASH_KEY`, `AUTH_RATE_LIMIT_MAX_ATTEMPTS`,
`AUTH_RATE_LIMIT_WINDOW_SECONDS`, `CRM_MEDIA_MAX_BYTES`,
`CRM_EXPORT_MAX_ROWS`, `CRM_EXPORT_MAX_FILES`, `CRM_EXPORT_MAX_BYTES`,
`CRM_EXPORT_TTL_SECONDS`, plus provider-managed SMTP names documented in
`docs/ENVIRONMENT_VARIABLES.md`. Values are intentionally omitted.
