# Owner Value Manifest

Enter secrets only in the encrypted secret store of the named Staging or
Production project. Values never belong in chat, Git, screenshots or reports.

| Name                             | Purpose                             | Class                     | Source/destination                      | Scope                              | Validation                                |
| -------------------------------- | ----------------------------------- | ------------------------- | --------------------------------------- | ---------------------------------- | ----------------------------------------- |
| `NEXT_PUBLIC_APP_URL`            | Canonical application origin        | Public                    | Hosting environment                     | Each environment                   | Exact HTTPS origin and redirect allowlist |
| `DATABASE_PROVIDER`              | Select hosted data adapter          | Non-secret gate           | Host environment                        | Preview/Production                 | Must be `neon` when hosted                |
| `NEON_AUTH_BASE_URL`             | Managed Better Auth endpoint        | Public identifier         | Neon branch → host                      | Environment-specific               | Exact branch and TLS                      |
| `NEON_DATA_API_URL`              | RLS-enforced Data API endpoint      | Public identifier         | Neon branch → host                      | Environment-specific               | JWT/RLS tenant test                       |
| `NEON_AUTH_COOKIE_SECRET`        | Signs server session cache          | Secret                    | App-owned generator → host secret store | Environment-specific               | Minimum 32 characters; never client-side  |
| Neon pooled runtime connection   | Serverless administrative jobs      | Secret                    | Neon Preview/Production → host store    | Environment-specific               | Pooler host and least-privilege role      |
| Neon direct migration connection | Controlled additive migrations      | Secret                    | Neon → CI/admin store                   | Environment-specific               | Direct host, migration role and checksum  |
| `CREDENTIAL_ENCRYPTION_KEY`      | AES-256-GCM envelope master key     | Secret                    | Owner key generator → host secret store | Environment-specific/versioned     | 32-byte decode and vault round trip       |
| `INNGEST_EVENT_KEY`              | Durable event publication           | Secret                    | Inngest → host secret store             | Non-production/Production separate | Signed event smoke                        |
| `INNGEST_SIGNING_KEY`            | Function endpoint verification      | Secret                    | Inngest → host secret store             | Non-production/Production separate | Signed sync and invalid-signature denial  |
| `META_APP_ID`                    | Meta application identity           | Non-secret ID             | Meta App dashboard → host               | Environment/app-specific           | Exact app owner                           |
| `META_APP_SECRET`                | Webhook/OAuth proof                 | Secret                    | Meta App dashboard → host secret store  | Environment/app-specific           | Signature negative/positive test          |
| `META_WEBHOOK_VERIFY_TOKEN`      | GET challenge secret                | Secret                    | Owner-generated → Meta and host         | Environment-specific               | Challenge verification                    |
| `META_GRAPH_API_VERSION`         | Reviewed current Graph version      | Non-secret                | Meta review decision → host             | All                                | Version pattern and review evidence       |
| `META_WHATSAPP_CONFIG_ID`        | Embedded Signup configuration       | Non-secret ID             | Meta dashboard → host                   | All                                | Asset relationship proof                  |
| `META_OAUTH_REDIRECT_URL`        | Exact callback                      | Public                    | Host URL → Meta dashboard               | Each environment                   | Same-origin exact path                    |
| Meta WABA/phone/Instagram IDs    | Connected assets                    | Non-secret IDs            | Meta owner                              | Workspace connection               | Provider health check                     |
| `PLATFORM_*_API_KEY`             | Paid platform AI                    | Secret                    | Paid AI provider → host store           | Environment-specific               | Synthetic connection test and budget      |
| Workspace BYOK                   | Per-workspace paid AI               | Secret                    | Owner UI → encrypted database envelope  | Workspace                          | Masked status and test/rotate/delete      |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Browser abuse widget                | Public credential         | Cloudflare → host                       | Domain/environment-specific        | Expected hostname/action                  |
| `TURNSTILE_SECRET_KEY`           | Server verification                 | Secret                    | Cloudflare → host store                 | Domain/environment-specific        | Fresh single-use token verification       |
| SMTP/auth email settings         | Verification/recovery delivery      | Secret + sender IDs       | Email provider → Managed Better Auth    | Environment-specific               | Controlled mailbox delivery test          |
| Monitoring DSN/project           | Safe telemetry                      | Secret/public by provider | Monitoring provider → host              | Environment-specific               | Redacted error and alert smoke            |
| Domain/legal URLs                | Privacy, Terms, deletion, retention | Public                    | MANI-owned published pages              | Production                         | Owner/legal approval                      |
| `LIVE_PROVIDER_SEND_ENABLED`     | Global live-send gate               | Non-secret gate           | Host environment                        | Must remain `false` in Prompt 10   | Preflight and runtime health              |
| `LIVE_TEST_RECIPIENT_ALLOWLIST`  | Pilot-only recipients               | Sensitive config          | Host secret store                       | Pilot only                         | Exact authorized recipient                |

Prompt 10 also requires `APP_DEPLOYMENT_MODE`, `AUTH_SIGNUP_MODE`,
`ENABLE_EMAIL_CONFIRMATION`, `EMAIL_DELIVERY_VERIFIED`,
`AUTH_CAPTCHA_MODE`, `AUTH_RATE_LIMIT_MODE`,
`AUTH_RATE_LIMIT_HASH_KEY`, `META_CONNECTION_MODE`,
`VERCEL_COMMERCIAL_PLAN_CONFIRMED` and
`PRODUCTION_DEPLOYMENT_APPROVED`. Production public signup is rejected unless
verification delivery is proven. Prompt 10 hosting remains invite-only,
Sandbox and `LIVE_PROVIDER_SEND_ENABLED=false`.
