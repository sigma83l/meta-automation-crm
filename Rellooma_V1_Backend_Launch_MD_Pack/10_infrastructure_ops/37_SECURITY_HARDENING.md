# Security Hardening Checklist

**Source page:** 34

- [ ] Owner/Admin MFA readiness.
- [ ] HttpOnly secure cookies + session rotation.
- [ ] CSRF protection for state-changing browser requests.
- [ ] PKCE/state for OAuth where applicable.
- [ ] Strict redirect allowlist.
- [ ] Turnstile + server rate limits for signup/recovery/forms.
- [ ] Webhook signature verification: Meta/Paddle/Resend.
- [ ] Service-role keys never shipped client-side.
- [ ] CSP/HSTS/X-Content-Type-Options/Referrer-Policy as applicable.
- [ ] SSRF-safe remote media fetch allowlist/validation.
- [ ] Private storage + short-lived signed URLs.
- [ ] Upload MIME/size validation + sanitized filenames.
- [ ] No PII in generic analytics/logs.
- [ ] Safe error IDs; internal cause server-side.
- [ ] No blind retry of uncertain sends.
- [ ] Emergency global/workspace send pause.
- [ ] Audit log for role/settings/integration/billing/delete changes.
- [ ] Dependency/secret scan in CI.
- [ ] RLS regression test for every tenant table/storage path.
- [ ] Environment secrets scoped; Preview cannot reach Production.
