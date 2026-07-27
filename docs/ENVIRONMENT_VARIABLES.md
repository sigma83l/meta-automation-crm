# Environment Variable Inventory

Names and purposes only. Values belong in ignored local files or secure hosting
settings.

| Name                            | Exposure                       | Purpose                                                      |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| `NEXT_PUBLIC_APP_URL`           | Browser-safe                   | Canonical application origin                                 |
| `NEXT_PUBLIC_SUPABASE_URL`      | Browser-safe                   | Supabase project URL                                         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe public credential | RLS-protected Supabase browser access                        |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server-only                    | Trusted administrative operations after workspace resolution |
| `INNGEST_EVENT_KEY`             | Server-only                    | Emit durable workflow events                                 |
| `INNGEST_SIGNING_KEY`           | Server-only                    | Verify Inngest requests                                      |
| `LIVE_PROVIDER_SEND_ENABLED`    | Server-only                    | Environment-level live-send gate; insufficient by itself     |
| `LIVE_TEST_RECIPIENT_ALLOWLIST` | Server-only                    | Explicit non-production recipient allowlist                  |
| `CREDENTIAL_ENCRYPTION_KEY`     | Server-only                    | Versioned encryption for workspace BYOK/provider credentials |

Future prompts may add provider IDs, callback configuration, CAPTCHA/SMTP, and
observability names. Secret values must never use a `NEXT_PUBLIC_` prefix.
