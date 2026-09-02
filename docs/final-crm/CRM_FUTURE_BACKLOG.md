# CRM backlog

Recorded 2026-09-03 at `691f10a`. Everything here is known, deliberate and not
done. Nothing here is a surprise waiting to be found.

## Absent write surfaces — the two blocked E2E flows

**Editing a remembered fact.** `contact_facts` has an engine writer and a read
path and no product surface. There is no way for a person to correct what the
assistant remembered, which blocks the pack's flow 4 and means a wrong fact can
only be fixed by a stronger observation arriving. The memory policy already
treats `human_verified` as authoritative, so the rule the surface needs exists;
what is missing is the surface.

**Managing a follow-up.** `scheduleFollowUp`, `settleFollowUp` and
`recordFollowUpAttempt` exist and are tested, and no route calls any of them.
This blocks flow 5. The record's Follow-up section reads them; nothing writes.

Whether these are unfinished Pack 01 work or Pack 02 scope is an owner decision.
They are the two largest gaps in this pack.

## Same defect class, no caller yet

`proposeAction` inserts into `crm_next_action_projection` through the caller's
own client, which grants `authenticated` select only — the identical bug that
made `settleProposal` do nothing. No route calls it today, so it is not live,
but anyone wiring a "propose an action" button will hit the same wall. The fix
is the same shape as `settle_next_action`.

## Waiting on Pack 03

- **The structured extraction call.** `applyAiProposal` is the seam; the
  provider interface has classify and draft and no third call. Until then the AI
  write engine runs from tests and from seeded suggestions.
- **One writer for `contact_facts`.** The turn's `persistFacts` and the CRM's
  `rememberFacts` share a conflict target so they cannot drift on what matters,
  but two writers is one too many and the merge belongs with the Pack 03 wiring.

## Waiting on Pack 02

- A member directory, so the Owner column can name a person instead of saying
  "A teammate".
- A page for a score snapshot, so the Now card can link its evidence instead of
  naming a reference.

## Test harness

`auth.spec.ts`, `owner-panel.spec.ts` and `visual-qa.spec.ts` fail locally and
pass in CI. Cause identified and fixed for the CRM specs in
`tests/e2e/support/workspace.ts`: the signup and onboarding submits race React
hydration, and a click before hydration performs a native GET that clears the
form. Applying the same helper to those three is a mechanical change nobody has
made.

## Not defects

The following look like gaps and are decisions, recorded so they are not
"fixed" later by someone who did not know:

- Attention priority and derived next actions are **not stored**. They are
  functions of current state; a row holding one is a cache with no invalidation.
- Accepting a suggestion **performs nothing**. The CRM proposes; the domain that
  owns the send executes.
- `crm_radar_view` **does not rank**. Ranking in SQL would be a second
  implementation of rules that live in TypeScript.
- Ordering inside a view is by recency, never by priority. See `CRM_UX_FINAL.md`.
