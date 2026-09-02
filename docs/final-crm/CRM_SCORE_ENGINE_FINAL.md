# CRM score engine

Recorded 2026-09-03 at `691f10a`.

## What it is

`src/modules/crm/qualification-score.ts` computes a 0–100 score from evidence
rows under a versioned config. Eight components plus a disqualifier. Integer
arithmetic throughout rather than a rounding at the end, so a score does not
depend on the order rows come back in.

`now` is a parameter rather than read inside, so replaying the same evidence at
the same instant gives the same answer — expiry is the only thing in the
function that time touches.

## The rules with teeth

- **A contribution nobody can trace is no contribution.** Evidence without an
  `evidence_ref` does not count, and the snapshot's `reason_codes` say
  `evidence_discounted` so the gap is visible rather than silent.
- **A component floors at zero.** Negative evidence within an area cancels that
  area and no more. Pulling the total down is what a disqualifier is for, and
  keeping them separate stops "not a great fit" being promoted into "do not
  pursue".
- **A disqualifier may never raise a score**, whatever sign somebody recorded it
  with.
- **Blockers are reported, not left as silent zeros.** An unevidenced area names
  the question still worth asking, which is the most actionable thing a score
  can say.
- **Both tables are append-only.** An editable config version makes every
  snapshot citing it misreport how it was computed; an editable snapshot
  destroys history rather than correcting it.
- **An override is not a score.** `overrideScore` requires a manager, a reason
  and an audited row; the components stay as the evidence computed them while
  the total is the person's, so the snapshot shows the gap between what the
  evidence supported and what somebody decided.

`scoreFromEvidence` was removed from `revenue-state.ts` when this landed. It
returned a bare number with no components, version or evidence requirement, and
keeping it beside this engine would have left two scorers and an invitation to
call the one that cannot explain itself.

## The golden matrix

`tests/golden/score-matrix.test.ts` asserts all seven cases of
`02_SCORE_GOLDEN_MATRIX`, key set compared with the pack's file.

| Case                                                     | How it holds                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Same evidence + config produces the same score           | Equal on repeat and on reversed input order — the way rows actually arrive               |
| Every contribution has an evidence reference             | An unreferenced row moves nothing and appears in no reference list                       |
| A disqualifier reduces the score without changing facts  | Components identical, total lower, input untouched                                       |
| A config version change creates a new snapshot           | The version travels into the snapshot; different weights are a different answer          |
| A manual override requires role, reason and audit        | Operator refused, blank reason refused, the stored row names who and why                 |
| Stale evidence recalculation is deterministic            | The stale row is gone from the answer, not discounted in it; stable at any fixed instant |
| A score alone never marks Customer or a verified outcome | A transition carries actor and reason codes and has nowhere to put a score               |

Two of these stop where a double can prove them. That a config version cannot be
redefined, edited or deleted is a database guarantee and is asserted in
`tests/migrations/qualification-score-engine.test.ts`; the golden file proves the
half that is pure and says so rather than claiming the rest.
