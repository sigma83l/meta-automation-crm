# Repository Reconciliation Before Implementation

**Source pages:** 2, 27, 35, 38, 41–42

## Mandatory discovery output

Create `REPO_BASELINE.md` in the implementation branch containing:

- repo / branch / BASE_SHA / dirty state;
- package manager and framework/runtime versions;
- application boundaries: public site, authenticated app, API/server boundary;
- route inventory for site + app + webhooks;
- current database objects and migration history;
- current RLS/storage policies;
- auth and workspace resolver behavior;
- current Meta webhook/connect/send flow;
- current provider adapter boundaries;
- current queues/background jobs;
- current test inventory and CI pipeline;
- current environment matrix and provider project IDs (never secret values).

## Reconcile, do not duplicate

Illustrative endpoints and table names in this pack are contracts, not commands to create duplicates. If equivalent production code already exists, extend or harden it.

## Baseline hash

Record a baseline hash/commit for existing Auth/RLS/Meta semantics. Any change must carry:

- reason,
- migration/compatibility plan,
- regression tests,
- rollback path.
