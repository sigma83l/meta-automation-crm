# Release Candidate Security Review

Date: 2026-07-29

Scope: all changes from Prompt 0 through Prompt 7

Gate: zero unresolved Critical or High findings

## Findings

| ID         | Severity | Reproduction/root cause                                                                           | Fix and regression                                                                                                                  | Status |
| ---------- | -------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ |
| RC-SEC-01  | High     | Signed Meta OAuth state was reusable until expiry because no server nonce was consumed.           | Added hashed, expiring nonce storage, atomic one-time service-role consumption, timestamp validation, unit/integration/pgTAP tests. | FIXED  |
| RC-SEC-02  | High     | Full audit reported CVE-2026-14257 through ESLint → minimatch → brace-expansion.                  | Forced patched 5.0.8 and added a two-shape minimatch compatibility patch; full and production audits, lint and build pass.          | FIXED  |
| RC-SEC-03  | Medium   | Instagram attachment payload URLs could become `providerMediaId`, creating a future SSRF footgun. | URLs are discarded; only opaque provider IDs survive normalization. Loopback URL regression passes.                                 | FIXED  |
| RC-FUNC-01 | Medium   | Instagram attachment arrays were read through an object-only helper and silently dropped.         | Correct array extraction plus image/URL regression.                                                                                 | FIXED  |
| RC-QA-01   | Low      | Rollback test used a global workspace count and raced the load suite.                             | Assert the failed auth identity was transactionally absent. Parallel integration run passes.                                        | FIXED  |

No Critical findings were found. No Critical or High findings remain open.

## Boundary review

- Auth/session: Supabase SSR cookies, rotation, global logout contract, disabled
  membership denial and generic public errors are covered.
- Tenant/IDOR: browser workspace IDs never establish authority; RLS, composite
  keys, trusted workspace filters and private Storage policies deny cross-tenant
  reads, writes, searches, exports and files.
- Service role: imported through `server-only`, receives trusted workspaces,
  has no client-bundle marker and is unavailable through browser grants.
- CSRF: every browser mutation uses the short-lived HttpOnly SameSite
  double-submit contract. Public webhook writes use HMAC instead.
- Webhooks/replay: exact raw bytes are HMAC verified, provider accounts route
  tenants, event uniqueness deduplicates, OAuth state is now one-time.
- SSRF/files: no remote fetch exists; webhook URLs are discarded; upload bytes
  are magic-byte checked, size limited, privately stored and safely named.
- ZIP/spreadsheets: generated archive paths reject traversal, sheets neutralize
  `=`, `+`, `-`, `@`, and reopened artifacts prove integrity.
- XSS: React text rendering is retained; an executable-looking customer name is
  displayed literally and creates no DOM image or script side effect.
- AI/prompt injection: strict schemas, context minimization, approved knowledge,
  confidence/human gates and synthetic-only free mode fail closed.
- Credentials/logs: AES-256-GCM server envelopes, masked status, export
  filtering, stable errors, no payload logging, secret and bundle scans pass.
- Redirect/OAuth: auth callback destinations are allowlisted; Meta state is
  workspace/channel bound, signed, expiring and consumed once.
- Idempotency/races: database uniqueness and atomic functions cover inbound
  retry; send reservation models crash-after-provider as `sent_unknown`.

## Medium dispositions

The in-memory auth limiter is suitable only for local/single-process validation.
A shared production limiter and real Turnstile configuration are external
deployment gates, not accepted production controls. Hosted Inngest delivery,
export cleanup/retention workers, real provider media retrieval and live Meta
token exchange remain disabled or blocked. These items are listed in
`docs/KNOWN_LIMITATIONS.md` and prevent a Production claim.
