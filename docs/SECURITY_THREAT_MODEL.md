# Security Threat Model

## Assets and trust zones

Protected assets are customer identity and messages, private media, workspace
configuration, exports, provider credentials, AI keys, audit evidence, and
outbound-send authority.

The browser, webhook payload, provider callback parameters, uploaded files, AI
output, and client-provided workspace IDs are untrusted. Trusted authority is
established server-side from verified identity, membership, stored connection
mapping, RLS, and current policy state.

## Primary threats and controls

| Threat                     | Foundation control                                                                  | Required later proof                          |
| -------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------- |
| Cross-workspace IDOR       | Forced RLS, membership-derived authority, forged-hint denial, Storage path policies | Live local denial tests pass                  |
| Service-role exposure      | Server-only module, no browser import, bundle and secret review                     | Repeat on every release                       |
| Secret leakage             | Ignored local env files, placeholder example, secret scan, non-secret health output | Log/export/browser negative tests             |
| Unauthorized provider send | Sandbox default, multi-factor live gate, no real adapter                            | Policy-before-send and allowlisted live smoke |
| Webhook forgery/replay     | Raw-body HMAC, stored account routing, event idempotency design                     | Prompt 4 signature/replay/dedupe tests        |
| Duplicate sends            | Idempotency key in provider command                                                 | Prompt 5 crash/retry tests                    |
| Prompt injection           | App-owned structured output, approved knowledge only, human review fallback         | Prompt 3 adversarial fixtures                 |
| Unsafe files/SSRF          | No media fetch in foundation                                                        | Prompt 2 MIME/content and Prompt 7 SSRF tests |
| Spreadsheet/ZIP injection  | No export in foundation                                                             | Prompt 2 formula and path traversal tests     |
| Dependency compromise      | Exact versions, lockfile, CI, audit/review                                          | Prompt 7 dependency audit                     |

| Credential stuffing | CAPTCHA seam, bounded local limiter, provider 429 mapping | Distributed limiter before production |
| User enumeration | Generic login/recovery/account-disabled responses | SMTP delivery review |
| CSRF/session theft | SSR rotation, secure production cookies, SameSite CSRF cookie | Preview security-header review |

## Prompt 1 limitations

Local Auth, RLS and Storage policy enforcement is implemented and tested.
Production SMTP, Turnstile keys, a distributed rate limiter, a hosted Supabase
project and deployed security-header verification remain external gates.
`ENABLE_EMAIL_CONFIRMATION=false` avoids a verification block but permits
unverified addresses; enable it before risk policy requires verified ownership.
Password reset still requires production SMTP.

## Incident-safe defaults

Missing configuration means pending or denied, never an implicit live fallback.
The health route reports capability state without values. Provider errors use
stable error codes. Future emergency controls must pause workspace,
automation, and conversation work and cancel queued steps where possible.
