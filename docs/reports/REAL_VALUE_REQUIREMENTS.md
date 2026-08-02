# REAL_VALUE_REQUIREMENTS

Do not send values in chat. Enter secrets only in the named platform encrypted
store.

- Vercel Preview: owner-email allowlist (non-secret) and generated application
  secrets in Preview scope; production scope keeps provider values absent.
- Neon: Prompt 11 decision on a Production-suitable plan, backup/PITR window,
  private object storage and least-privilege migration/runtime roles.
- Meta: Business/App/WABA/phone/Instagram Professional identifiers, reviewed
  scopes, app secret and webhook token in Vercel Production encrypted settings.
- AI: paid platform project/model/key, budget and BYOK policy in the owning
  provider and Vercel Production settings.
- Inngest: isolated environment, event key and signing key in encrypted Preview
  or Production scopes as appropriate.
- Turnstile: allowed domains plus site/secret keys in corresponding scopes.
- Email: verified SMTP/provider, sender domain and confirmation policy.
- Monitoring: project/DSN and alert destinations.
- Legal/domain: approved domain, privacy, terms, deletion and retention URLs;
  DNS changes and provider terms require MANI approval.

Exact variable names and validation methods are in
`docs/OWNER_VALUE_MANIFEST.md`. No real send or Production promotion is part of
this packet.
