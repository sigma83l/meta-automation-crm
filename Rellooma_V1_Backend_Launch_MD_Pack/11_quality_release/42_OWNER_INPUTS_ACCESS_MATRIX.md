# Owner-Only Inputs and Scoped Developer Access

**Source page:** 39

Developer should not demand owner-level secrets/access unless a provider cannot be configured otherwise.

| Input | Developer receives | Owner keeps |
|---|---|---|
| GitHub | repo collaborator / branch scope | org ownership/billing |
| Vercel | project-scoped access | team billing/ownership |
| Supabase | project developer access; service-role only through server env | org ownership/recovery |
| Meta | app/system-user or required scoped assets | Business owner/admin, billing |
| Paddle | scoped API/webhook credentials as supported | account owner/billing/payout |
| Resend | sending/domain/webhook scoped key | team billing/admin |
| Cloudflare | DNS edit for Rellooma zone only if needed | registrar/account super-admin |
| Google Workspace | normally no admin access; owner supplies exact DNS/mail values | Super Admin |
| AI providers | project-scoped server key/budget limits | org billing/owner |
| Legal/Product truth | approved operator identity, terms, live-claim approvals | legal responsibility |

Record access scope and owner in evidence. Never place actual secret values in Markdown.
