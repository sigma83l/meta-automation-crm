# Environment Variable Inventory

Names and purposes only. Values belong in ignored local files or secure hosting
settings.

| Name                             | Exposure                       | Purpose                                                      |
| -------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| `NEXT_PUBLIC_APP_URL`            | Browser-safe                   | Canonical application origin                                 |
| `NEXT_PUBLIC_SUPABASE_URL`       | Browser-safe                   | Supabase project URL                                         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | Browser-safe public credential | RLS-protected Supabase browser access                        |
| `SUPABASE_SERVICE_ROLE_KEY`      | Server-only                    | Trusted administrative operations after workspace resolution |
| `INNGEST_EVENT_KEY`              | Server-only                    | Emit durable workflow events                                 |
| `INNGEST_SIGNING_KEY`            | Server-only                    | Verify Inngest requests                                      |
| `LIVE_PROVIDER_SEND_ENABLED`     | Server-only                    | Environment-level live-send gate; insufficient by itself     |
| `LIVE_TEST_RECIPIENT_ALLOWLIST`  | Server-only                    | Explicit non-production recipient allowlist                  |
| `CREDENTIAL_ENCRYPTION_KEY`      | Server-only                    | Versioned encryption for workspace BYOK/provider credentials |
| `PLATFORM_AI_PROVIDER`           | Server-only                    | Selects the paid platform provider adapter                   |
| `PLATFORM_GEMINI_API_KEY`        | Server-only                    | Paid platform Gemini credential                              |
| `PLATFORM_OPENAI_API_KEY`        | Server-only                    | Paid platform OpenAI credential                              |
| `PLATFORM_ANTHROPIC_API_KEY`     | Server-only                    | Paid platform Anthropic credential                           |
| `AI_PROVIDER_TIMEOUT_MS`         | Server-only                    | Provider request deadline                                    |
| `ENABLE_EMAIL_CONFIRMATION`      | Server-only                    | Enables future confirmation-required application behavior    |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Browser-safe public credential | Renders the Turnstile widget                                 |
| `TURNSTILE_SECRET_KEY`           | Server-only                    | Verifies Turnstile tokens                                    |
| `AUTH_CAPTCHA_MODE`              | Server-only                    | Selects `fake` locally or `turnstile` in production          |
| `AUTH_RATE_LIMIT_MAX_ATTEMPTS`   | Server-only                    | Attempts allowed per local rate-limit window                 |
| `AUTH_RATE_LIMIT_WINDOW_SECONDS` | Server-only                    | Local rate-limit window duration                             |
| `SMTP_HOST` / `SMTP_PORT`        | Server-only                    | Production Auth email transport                              |
| `SMTP_USER` / `SMTP_PASSWORD`    | Server-only                    | Production SMTP authentication                               |
| `SMTP_FROM`                      | Server-only                    | Approved Auth sender identity                                |
| `CRM_MEDIA_MAX_BYTES`            | Server-only                    | Maximum accepted private media size                          |
| `CRM_EXPORT_MAX_ROWS`            | Server-only                    | Maximum rows collected per sheet                             |
| `CRM_EXPORT_MAX_FILES`           | Server-only                    | Maximum files included in a ZIP                              |
| `CRM_EXPORT_MAX_BYTES`           | Server-only                    | Maximum accumulated/export ZIP bytes                         |
| `CRM_EXPORT_TTL_SECONDS`         | Server-only                    | Private export availability window                           |

Secret values must never use a `NEXT_PUBLIC_` prefix.
