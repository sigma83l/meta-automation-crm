# CRM architecture

Recorded 2026-09-03 at `691f10a`.

## The chain

`Conversation → Memory → Decision → Action → Outcome`, and each arrow is a
different module with a different reason to exist.

```
inbound message
  → turn engine (src/modules/rcos)         12 steps, policy before any model
      ├── hydrate      contact_facts, via currentFacts (expired dropped)
      ├── evaluatePolicy   consent, human takeover, billing, feature flags
      ├── understand / retrieve / decide / compose      the model's part
      └── persistFacts     what the memory policy accepted, before commit
  → CRM repository (src/modules/crm)
      ├── qualification score       evidence in, snapshot out, append-only
      ├── attention priority        computed on read, never stored
      ├── next action               derived computed; proposed stored
      └── AI write engine           a proposal, classified, never a column name
  → surfaces
      ├── /crm         the queue, one page at a time from the projection
      └── /crm/[id]    Now card, timeline, suggestions, audit
```

## The four rules that shape it

**A model never names a column.** `AiCrmProposal` has facts under keys, evidence
under the eight scored components, values for fields the workspace declared
model-writable, and a stage from a fixed vocabulary. There is nowhere in the
type to put a table, a path or an operator. `classifyProposal` then classifies
every candidate — `confirmed | inferred | conflicted | rejected` — using the
rules that already exist rather than a second set, because a second set would be
a second answer to "may this be written".

**What is derived is computed; what was decided is stored.** A next action
derived from current state is a function of what is true now, so a row holding
it would be a cache with no invalidation and a second answer able to disagree
with the live one. A next action _proposed_ by a model or a person was made at a
time and has to survive until it is accepted, executed or superseded, so that
gets a row — and `crm_next_action_projection` refuses `derived` on the way in.
Attention priority follows the same rule and is never persisted.

**One implementation per question.** Expiry is `hasExpired`, shared by the write
path and the read path, rather than a `valid_until > now()` predicate beside it.
Ranking lives in TypeScript and `crm_radar_view` supplies its inputs without
re-encoding it in SQL. Lifecycle rules live in `authorizeLifecycleTransition`
and `record_lifecycle_transition` owns only atomicity. Two implementations of one
rule disagree eventually, and only in production.

**Engines write through service role; people write through a policy.** The
tables an engine owns — `contact_facts`, `qualification_evidence`,
`lifecycle_events`, `tasks_followups`, `opportunities`, `crm_score_configs`,
`crm_score_snapshots`, `crm_next_action_projection` — grant `authenticated`
select and nothing else. The single exception is `settle_next_action`, two
columns wide, because answering a suggestion is the one thing a person does to a
projection.

## Where the AI write engine stops

`applyAiProposal` is the seam Pack 03's structured extraction call will land on.
The provider interface in `ai-turn-ports.ts` has two calls — classify and draft
— and adding a third is the AI orchestration engine's work. Until then the
engine runs from tests and from a person answering a seeded suggestion. That is
a dependency on a later pack, named rather than papered over with a fake
producer that would make the path look exercised.

## Feature gates

Ten flags, one gate each, placed where the answer is still cheap: before the six
analytics counts, before `applyAiProposal`'s five reads. Three are narrower than
the flag — creation is gated, reading is not. The turn gate reads after billing,
so a workspace with both problems is told the one it can fix, and it reads inside
`evaluatePolicy` so a turn arriving by any route is gated identically and the
refusal lands in `turn_records` with a reason the review surface can explain.
