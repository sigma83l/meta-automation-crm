# Environment Matrix

| Property              | Local                      | Preview/staging                   | Production             |
| --------------------- | -------------------------- | --------------------------------- | ---------------------- |
| `APP_DEPLOYMENT_MODE` | `local`                    | `preview`                         | `production`           |
| Data                  | deterministic synthetic    | isolated synthetic                | approved customer data |
| Supabase              | local Docker               | dedicated approved project/branch | approved Pro project   |
| CAPTCHA               | fake                       | Turnstile test/site config        | Turnstile production   |
| Auth limiter          | memory or database         | database                          | database               |
| Signup                | self-service test          | invite-only recommended           | owner decision         |
| Meta mode             | sandbox                    | sandbox until pilot approval      | live only after review |
| AI                    | deterministic              | paid/BYOK test with approval      | approved paid/BYOK     |
| Live send             | false                      | false except allowlisted pilot    | explicit activation    |
| Load tests            | small local only           | approved commercial staging       | prohibited             |
| Secrets               | local ignored placeholders | platform secret store             | platform secret store  |

Production parsing fails when Supabase, Inngest, credential encryption,
Turnstile or database limiter names are absent. Live Meta mode additionally
requires exact same-origin callback configuration.
