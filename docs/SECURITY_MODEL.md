# Security Model

The canonical detailed threat model is `docs/SECURITY_THREAT_MODEL.md`.

Prompt 10 additions:

- production self-service signup is rejected until confirmation and email
  delivery are both proven;
- Turnstile requires server verification, expected action, expected hostname
  and a fresh five-minute provider timestamp;
- locale/theme profile mutations retain CSRF protection;
- onboarding drafts are bounded, non-secret and manager-only through a trusted
  workspace;
- provider media resolves an opaque ID through fixed Graph endpoints, then
  accepts only HTTPS Meta CDN hosts, bounded bytes and approved MIME types;
- customer detail no longer renders raw internal JSON;
- Production preflight requires Sandbox Meta mode and
  `LIVE_PROVIDER_SEND_ENABLED=false` for this release.

No real customer data, token, provider secret or Production seed is present.
