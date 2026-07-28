# Prompt 1 Test Report

## Scope

Secure Supabase email/password authentication, server-side sessions, atomic
workspace provisioning, forced tenant RLS, private Storage authorization,
CAPTCHA/rate-limit seams, recovery UI and local proof.

## Local evidence

- Fresh migration reset: pass.
- pgTAP schema/RLS/Storage assertions: 13 pass.
- Auth/unit suite: 16 pass.
- Live local integration suite: 10 pass, including two-business CRUD denial,
  forged workspace hint, no-membership fail closed, disabled account, atomic
  rollback, session refresh/logout/recovery and Storage denial.
- Auth/foundation E2E: 10 pass across desktop and mobile Chromium.
- Formatting, lint, strict typecheck, production build and secret scan: pass.
- Client bundle scan: 15 assets checked; no server-only environment names.

## Confirmation and recovery risk

`ENABLE_EMAIL_CONFIRMATION` is initially `false`. Signup therefore creates an
immediate session locally and does not block on verify-email. The application
contract supports the `true` state and confirmation callback, but production
must supply verified SMTP and approved redirect URLs. With the flag disabled,
email ownership is not proven; recovery email delivery still depends on SMTP.

## External gates

Hosted Supabase project/region/Pro plan, production SMTP, Turnstile site and
secret keys, distributed edge rate limiting, DNS and deployment all require
MANI login, MFA, payment or explicit approval. No external resource was changed.
