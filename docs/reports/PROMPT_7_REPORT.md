# Prompt 7 Report

## Outcome

Local software Release Candidate: PASS, subject to the external gates in
`docs/KNOWN_LIMITATIONS.md`. No deployment, push, live provider call or real
customer data was used.

## Scope and checkpoint

- Repository: `/Users/zekigurselozbulak/Desktop/meta-automation-crm`
- Branch: `main`
- Accepted Prompt 6 SHA:
  `2869f9e40dbdcd3e4a856069562087a9faa8e43e`
- RC tag: `v0.1.0-rc.1`
- Latest migration: `20260729120000_rc_oauth_state_replay.sql`

The final exact RC SHA is emitted after the local checkpoint because a commit
cannot contain its own hash. Detailed test, security, performance, rollback and
feature evidence is split into the required top-level RC documents.

## Bugs fixed

- One-time, hashed Meta OAuth state consumption closes callback replay.
- Future-dated/tampered/expired OAuth state fails closed.
- Provider attachment URLs no longer cross the SSRF trust boundary.
- Instagram attachment arrays normalize correctly.
- Transaction rollback testing is concurrency-safe.
- High transitive brace-expansion advisory is removed with a patched release
  and narrow minimatch compatibility patch.
- Playwright uses stable Webpack dev mode after a reproduced Turbopack HMR
  panic; the separate optimized production build remains green.

## Gate

All local format, lint, type, unit, integration, database, migration,
Storage/RLS, AI, webhook, provider, automation, export, E2E, accessibility,
build, bundle, secret and dependency gates pass. Donor proof and exact RC SHA
are recorded after the final clean-diff review.

## Donor unchanged proof

- `/Users/zekigurselozbulak/Desktop/mani/project/MetricOne/repos/metric-App`:
  branch `feat/day01-identity-tenant-foundation`, SHA
  `27ea036b97e09b3798d80ca0a88d2c999d2af8cf`, clean before and after; final
  tracked-diff SHA-256 is the empty digest
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- `/Users/zekigurselozbulak/Desktop/mani/project/MetricOne/migration-sources/mani-marketing-dashboard`:
  branch `feature/live-ux-audit-growth-os-expansion`, SHA
  `073b966e492863ca6f052a37e3a6e7b4df757466`; its pre-existing five modified
  files plus `src/middleware.ts` and one untracked script are exactly the same
  status entries before and after. Final tracked-diff SHA-256:
  `2e641e4586e09f8e1f7fb23285aaef5801283739feae18a27cafe96c73733ea8`.
