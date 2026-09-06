# Production Infrastructure and Environment Isolation

**Source page:** 29

## Production expectations

| Layer | Expectation |
|---|---|
| Vercel | dedicated app/site mapping, protected previews, exact SHA evidence, env-scoped config |
| Supabase/Postgres | paid production project, RLS, indexes, pooling, security advisor, backup policy |
| Storage | private buckets, RLS, size/type limits, signed delivery, separate backup |
| Inngest | durable jobs, per-workspace concurrency, provider throttling, retries/failure handlers |
| Resend | verified transactional/marketing domains, webhook verification, suppression/consent |
| Paddle | sandbox first, scoped production credentials, verified webhook destinations |
| Meta | sandbox/allowlist before live, server-side credentials, monitored provider state |
| AI providers | server-side keys, model config table, fallback policy, data-retention review |
| Analytics | first-party events + privacy-configured external analytics; app NOINDEX |
| Cloudflare/DNS | ownership separate; exact records only from provider output |

## Environment matrix

| Environment | Purpose | Live send | Providers | Data |
|---|---|---|---|---|
| development | developer | no | sandbox/dev | synthetic/local/dev project |
| preview | PR visual/E2E | no | sandbox | isolated preview DB/data |
| staging | load/UAT/restore | no by default | sandbox/allowlisted test | production-shaped synthetic |
| production | approved pilot/public | feature-flag + owner approval | production providers | real tenant data |

**Never** share Production DB, email, webhook secret, Meta token, Paddle key, or AI secret with Preview/Staging.
