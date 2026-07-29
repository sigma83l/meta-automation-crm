# Release Candidate Rollback

Accepted pre-RC application checkpoint:
`2869f9e40dbdcd3e4a856069562087a9faa8e43e`.

No hosted environment was changed in Prompt 7. Local rollback is therefore a
Git operation only and must be performed explicitly; do not reset a dirty
workspace or rewrite shared history.

## Application rollback

1. Preserve logs and database evidence without secrets.
2. Confirm the exact deployed/tagged SHA and current worktree state.
3. Build the accepted Prompt 6 checkpoint in a clean worktree.
4. Deploy that immutable checkpoint through the approved platform workflow.
5. Rerun health, auth and two-workspace synthetic smoke tests.

## Database compatibility

Migration `20260729120000_rc_oauth_state_replay.sql` is additive. Prompt 6 code
does not reference its table/function, so the preferred rollback leaves the
migration applied. This avoids destructive schema work.

If removal is legally or operationally required, take and verify a database
backup, deploy compatible application code first, and add a new reviewed
corrective migration that drops `consume_meta_oauth_nonce` and
`meta_oauth_nonces`. Never edit or delete an applied migration. The table holds
only short-lived state hashes; it contains no access tokens.

The compatibility proof reset to migration `20260729010000`, applied the RC
migration forward and passed all 95 database assertions.
