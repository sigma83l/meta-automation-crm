# Database Target Decision — Prompt 10 revision

Decision: **Neon Postgres** for hosted application data.

The 2026-08-02 Preview-first prompt superseded the earlier preserve-current
decision. Accepted Supabase migrations and pgTAP tests remain the security
baseline. Neon Managed Better Auth replaces `auth.users`; the Neon Data API
preserves the PostgREST query boundary and database-enforced RLS. The hosted
port replaces user authority with the provider JWT and retains server-resolved
workspace membership.

Compatibility classification:

- schema, enums, constraints, indexes, workspace RLS: `PORTABLE_POSTGRES`;
- Supabase Auth: `REQUIRES_ADAPTER`, implemented with Managed Better Auth;
- `auth.users` trigger: `REQUIRES_ADAPTER`, mapped to `neon_auth.user`;
- Supabase Storage: `PROVIDER_SPECIFIC`; metadata is preserved, byte operations
  fail closed until private hosted object storage is configured;
- Realtime: `DEFERRED_NOT_V1`; no P0 route depends on it;
- Inngest: independent and disabled in Preview until scoped keys exist.

Topology: Neon project `plain-haze-14575029`, reserved Production branch
`br-curly-dream-ax4gouox` (provider bootstrap only), Preview/Staging branch
`br-patient-cell-ax5letch` (application migrations, no permanent seed). Region:
AWS US East 2. The current organization plan is Free; Production backup/PITR
and commercial limits require Prompt 11 confirmation.
