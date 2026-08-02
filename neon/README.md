# Neon migration boundary

The hosted application database uses Neon Postgres with Managed Better Auth and
the Data API. Apply `migrations/0000_supabase_compatibility.sql` first, then the
reviewed files in `supabase/migrations/` in filename order. The compatibility
layer maps the accepted `auth.users` references and workspace-provisioning
trigger to Managed Better Auth's `neon_auth.user` table during apply. It also
supplies metadata-only Storage tables so the portable PostgreSQL schema remains
intact.

`storage.objects` is not an object-byte store. Media routes fail closed until a
private hosted object-storage adapter is configured. No Production branch
receives application migrations during Prompt 10.
