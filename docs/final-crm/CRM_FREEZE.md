# CRM freeze status

**Not frozen.** Recorded 2026-09-03 at `691f10a`; deployment note added 2026-09-04.

The pack's terminal token is
`READY_FOR_V19A_CONTINUATION_WITH_CRM_ENGINE_FROZEN`, and it is not earned. This
file exists to say so precisely, because a freeze document that reads as a
freeze when it is not is worse than no document: the next pack starts on a
foundation nobody actually agreed was finished.

## What the terminal state requires, and where each one stands

| Requirement                              | State                   | Note                                                                               |
| ---------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `CRM_RBAC_RLS=PASS`                      | **Pass**                | 105 cells executed against a real engine. `CRM_SECURITY_EVIDENCE.md`.              |
| `CRM_MEMORY_PROVENANCE=PASS`             | **Pass**                | Seven golden cases. `CRM_MEMORY_ENGINE_FINAL.md`.                                  |
| `CRM_SCORE_EXPLAINABILITY=PASS`          | **Pass**                | Seven golden cases. `CRM_SCORE_ENGINE_FINAL.md`.                                   |
| `CRM_AI_WRITE_SAFETY=PASS`               | **Pass**                | Proposal shape and classification. `CRM_ARCHITECTURE_FINAL.md`.                    |
| `CRM_EN_TR_FA_RTL=PASS`                  | **Pass**                | All 54 visual cells. `CRM_VISUAL_EVIDENCE.md`.                                     |
| `CRM_MOBILE=PASS`                        | **Pass**                | 390px, no overflow on either surface.                                              |
| `CRM_VISUAL_QA=PASS`                     | **Blocked**             | Screenshots produced; the pack requires human review, which is not mine to give.   |
| `CRM_P0=0`, `CRM_P1=0`                   | **Pass as of this SHA** | Three P1s were found and fixed during this stage; see below.                       |
| `CRM_MATERIAL_P2=0`                      | **Not clear**           | Two absent write surfaces, listed in `CRM_FUTURE_BACKLOG.md`.                      |
| `CRM_GIT_SHA=CRM_CI_SHA=CRM_PREVIEW_SHA` | **Still blocked**       | Production now runs this code, but from a CLI upload, not a pushed SHA. See below. |
| `LIVE_SEND=false`                        | Holds                   | `/api/health` on the live deployment reports `liveSending: disabled`.              |
| `PRODUCTION=NOT_PROMOTED`                | **No longer true**      | Promoted 2026-09-04 at `9acb323` by owner decision, ahead of this freeze.          |

## The three defects this stage found and fixed

Each was found by building the evidence rather than by reading the code, which
is the argument for having built it.

1. **Answering a suggestion did nothing.** `crm_next_action_projection` grants
   `authenticated` select and nothing else, and `settleProposal` issued an
   update through the caller's own client. It matched no rows and reported the
   proposal missing. Every test that covered it used a double with no grants.
   Fixed by `settle_next_action`, a definer function two columns wide.
2. **A missing contact id was a crash page.** The record read threw into the
   error boundary, so a stale URL told an operator the workspace view could not
   be loaded. Fixed: it renders the application's not-found state, identically
   for a contact that never existed and one belonging to another workspace.
3. **The flag catalogue decided nothing.** The staff console shipped a resolver
   and an audited override and no code asked it. Ten flags now have exactly one
   gate each.

## What is left before this can be frozen

- Human screenshot review of the 54 visual cells in `CRM_VISUAL_EVIDENCE.md`.
- A push, a CI run and a protected preview at one SHA. Owner-gated: this
  repository's remote is not one I may push to.

  **Deployed 2026-09-04 at `9acb323` anyway, by owner decision.** `crm-prod`
  took the twelve outstanding migrations (91/91 relations present) and
  `app.rellooma.com` now serves this branch, replacing an Aug-23 build of
  `feature/v2-platforms`. That does not satisfy this condition and the row above
  still reads blocked: `vercel deploy --prod` uploads the working directory, so
  the live build corresponds to no commit any remote has, no CI run gated it,
  and the Vercel project still names `release/v1-preview` as the branch that
  updates production. Git = CI = Preview means three things agreeing on one SHA;
  what exists is one machine's copy of one of them.

  The consequence worth stating plainly: there is currently no way to reproduce
  the live build from a shared source, and the rollback path is
  `vercel rollback` to the Aug-23 deployment rather than a revert.

- A decision on the two absent write surfaces in `CRM_FUTURE_BACKLOG.md` -
  whether they are Pack 01 work that is unfinished or Pack 02 scope.
