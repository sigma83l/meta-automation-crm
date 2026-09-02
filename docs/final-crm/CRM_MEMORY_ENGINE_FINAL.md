# CRM memory engine

Recorded 2026-09-03 at `691f10a`.

## What it is

`src/modules/rcos/memory-policy.ts` decides whether a proposed fact may replace
what is stored. Four confidences, ordered: `inferred`, `high_confidence`,
`confirmed`, `human_verified`. A write is accepted when it is new, stronger, an
equally-confident refresh that is not older, or supersedes an expired fact.
Provenance is mandatory — a fact nobody can trace cannot be audited or
corrected, so a proposal without a source reference is refused outright.

## Both halves now exist

Writing has worked since step 9 of the pack. Reading did not, and that was the
defect this stage closed: `persistFacts` filled `contact_facts` and nothing put
those facts in front of a model, so a returning customer was asked for what they
had already answered. `currentFacts` now feeds `AiReplyInput.knownFacts`, which
the prompt renders as `KNOWN ABOUT THIS CONTACT`.

Three decisions in that path are worth stating:

- **Above the untrusted fence.** The facts sit with the approved FAQ and prices,
  not inside the block the model is told to distrust, because they are the
  workspace's own record. Fence markers inside a _value_ are still neutralised:
  a stored fact frequently originated in a customer's message.
- **Confidence travels with the value.** Filtering to confirmed only would drop
  most of what is known; showing a value without its standing would let a model
  quote a guess back as something the customer said.
- **Expiry through `hasExpired`**, shared with the write path. A `valid_until >
now()` predicate in the query would be a second answer to the same question,
  able to disagree about the boundary and only in production.

`knownFacts` is a required field on `AiReplyInput`, so a new caller cannot
silently compose a reply with no memory at all.

## The golden matrix

`tests/golden/memory-matrix.test.ts` asserts all seven cases of the pack's
`01_MEMORY_GOLDEN_MATRIX` under their own wording, and compares its key set with
the pack's file so a case cannot lose its test quietly.

| Case                                                              | How it holds                                                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Confirmed fact is never overwritten by lower-confidence inference | Refused by strength, in both the single and batch paths — a weak write cannot slip in beside a strong one |
| Returning customer is not asked for a known confirmed location    | The fact is in the prompt above the fence, and the system prompt says not to ask again                    |
| Conflicting phone/email becomes review rather than silent replace | `conflicted`, `commit: false`; the stored value stands                                                    |
| Expired availability/budget is not current truth                  | Dropped by `currentFacts`; a fresh observation supersedes it                                              |
| Human correction becomes authoritative                            | `human_verified` outranks a model's strongest claim, before and after                                     |
| AI extraction failure leaves messages intact and the CRM usable   | An empty proposal removes nothing; an unattributed one is refused                                         |
| A duplicate message event does not duplicate fact or evidence     | Evidence rejected as `already recorded`; facts land on one key                                            |

## One risk still standing

`contact_facts` has two writers: the turn's `persistFacts` and the CRM module's
`rememberFacts`. They share one named conflict target so they cannot drift on
the thing that matters, but a single writer would be better and belongs with the
Pack 03 wiring.
