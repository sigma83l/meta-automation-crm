# Environment Matrix

| Property              | Local                      | Preview/staging                   | Production                  |
| --------------------- | -------------------------- | --------------------------------- | --------------------------- |
| `APP_DEPLOYMENT_MODE` | `local`                    | `preview`                         | `production`                |
| Data                  | deterministic synthetic    | isolated synthetic                | approved customer data      |
| Supabase              | local Docker               | dedicated approved project/branch | approved Pro project        |
| CAPTCHA               | fake                       | Turnstile test/site config        | Turnstile production        |
| Auth limiter          | memory or database         | database                          | database                    |
| Signup                | self-service test          | invite-only recommended           | owner decision              |
| Meta mode             | sandbox                    | sandbox until pilot approval      | live only after review      |
| AI                    | deterministic              | paid/BYOK test with approval      | approved paid/BYOK          |
| Live send             | false                      | false except allowlisted pilot    | explicit activation         |
| Load tests            | small local only           | approved commercial staging       | prohibited                  |
| Secrets               | local ignored placeholders | platform secret store             | platform secret store       |
| UI locales            | en / tr / fa               | en / tr / fa                      | en / tr / fa                |
| Theme                 | Light / Dark / System      | Light / Dark / System             | Light / Dark / System       |
| Email delivery proof  | local inbox only           | owner-verified provider           | mandatory for public signup |
| Synthetic seed        | empty schema seed          | explicitly synthetic only         | prohibited                  |

Production parsing fails when Supabase, Inngest, credential encryption,
Turnstile or database limiter names are absent. Live Meta mode additionally
requires exact same-origin callback configuration.

Prompt 10 production-shaped deployment additionally requires invite-only signup
unless `ENABLE_EMAIL_CONFIRMATION=true` and `EMAIL_DELIVERY_VERIFIED=true`.
`LIVE_PROVIDER_SEND_ENABLED` must remain false.
