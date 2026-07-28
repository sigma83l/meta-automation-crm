# Infrastructure Setup and Owner Gates

No external project was created or changed in Prompt 0. An account is `READY`
only after authenticated access and ownership are verified without exposing
credentials.

| System    | Requirement                                                                                         | MANI action / approval                                                                |
| --------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| GitHub    | Client-owned organization and private repository; protected release flow                            | Login/MFA and approve repository creation in Prompt 8                                 |
| Vercel    | Client team and Pro plan for commercial production                                                  | Select team, accept billing, approve project and Production deployment                |
| Supabase  | Client-owned Pro project, approved region, Auth, Postgres, private Storage, backups                 | Login/MFA, region and billing approval; approve migration deployment                  |
| Inngest   | Client-owned production environment and observability                                               | Login/MFA, plan approval, secure event/signing key entry                              |
| Meta      | Business Portfolio, App, Business Verification where required, App Review and Advanced Access       | Legal identity, terms, MFA, reviewer evidence and approvals must be completed by MANI |
| WhatsApp  | Embedded Signup, WABA, phone number, display name, PIN/payment, templates and opt-in                | Own/approve assets, payment, templates and allowlisted tests                          |
| Instagram | Professional account, Instagram Login/OAuth, messaging scope; comment scope only when enabled       | Own/connect account and approve reviewed scopes                                       |
| AI        | Paid platform-default provider or explicitly disabled default; Gemini/OpenAI/Anthropic BYOK options | Create/select paid account, accept terms/billing, enter keys securely                 |
| Domain    | Client-owned domain, DNS, TLS, application/callback/webhook URLs                                    | Approve exact DNS changes; do not alter unrelated records                             |
| Legal     | Privacy policy, terms, data-deletion callback/page, retention and erasure process                   | Legal review and publication by the client                                            |

## Local status

- GitHub CLI: authenticated account detected; no repository write performed.
- Vercel CLI: authenticated account detected; no project write performed.
- Docker: installed.
- Supabase CLI: repository-local `2.110.0`; local Docker stack, migrations, Auth,
  RLS and private Storage tests verified. No hosted project was created.
- Meta, Supabase, Inngest, AI billing, DNS, and legal readiness were not
  authenticated or verified and remain `PENDING_OWNER`.

## Secret handling

Enter production values only in provider-managed encrypted environment
settings. Never paste them into prompts, issues, documentation, logs, fixtures,
Git history, or screenshots. Rotate any value exposed outside the approved
secret channel.

## Prompt 1 local database

Run `pnpm db:start`, `pnpm db:reset`, `pnpm test:db`, then
`pnpm test:integration:local`. The wrapper reads local CLI output into child
process environment without writing credentials. `pnpm db:stop` stops the
containers. Production requires MANI approval for project creation, region,
billing, SMTP, redirect URLs and migration deployment.
