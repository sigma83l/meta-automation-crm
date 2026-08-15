# CI/CD, Migration, and Release Discipline

**Source page:** 35

1. Record current BASE_SHA, branch, dirty state, provider project IDs.
2. Create/reuse feature/release branch; never force-push protected production branch.
3. Migration preflight on clean staging snapshot; verify RLS before merge.
4. Required checks: format, lint, strict TS, unit, integration, DB/RLS, E2E, a11y, visual, security, secret/dependency, build.
5. Replay webhook fixtures including duplicate and out-of-order events.
6. Protected Preview on exact commit; visual review against final UI/UX.
7. Production-shaped load/soak + restore drill.
8. Protected RC with exact SHA/deployment ID/test evidence.
9. Owner acceptance + external provider/legal gates where required.
10. Promote only accepted artifact; post-deploy smoke; monitor; rollback on P0.

## Release governance rule

Internal readiness score is not a marketing claim.

Launch candidate requires:

- P0/P1 blockers = 0;
- Critical/Major visual defects = 0;
- false public claims = 0;
- deployed SHA = tested SHA.
