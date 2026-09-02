# CRM current state, before this stage

The position at `dd1b28b`, 2026-09-02, before the work recorded in the rest of
this directory. Written from the schema and the routes rather than from prior
reports.

## Built and proven

Steps 1–7 of `docs/master-run/PACK_01_PLAN.md` were complete: the tables that
already existed had writers with the rules that make their rows trustworthy; the
qualification score engine was append-only in both its config and its snapshots;
attention priority was a level and reason chips rather than a number; the next
action was computed where it is derived and stored only where it was proposed;
the index was a queue; the record was a record rather than a data dump; and the
AI → CRM write engine classified proposals without letting a model name a column.

## What was wrong, and not yet known

Three defects were live at that SHA. None was visible from reading the code, and
each was found by building the evidence this stage produces.

1. **Answering a suggestion did nothing.** `settleProposal` updated
   `crm_next_action_projection` through the caller's own client, and that table
   grants `authenticated` select and nothing else. The update matched no rows;
   the repository read that as a missing proposal and returned 400 to a panel
   that ignores it. Every test covering it used a double with no grants.
2. **Customer memory was write-only.** `persistFacts` had been filling
   `contact_facts` since step 9 of the pack and nothing read it back into a
   turn. The model's entire view of a contact was one conversation's transcript,
   so a customer who confirmed something last week was asked again this week.
   `context-budget.ts` had reserved a `customer_memory` layer from the start and
   nothing ever filled it.
3. **The feature flag catalogue decided nothing.** The staff console shipped a
   resolver, an audited override mechanism and a seeded catalogue, and no
   product code asked it. Staff could switch a capability off for a customer who
   had reported a problem, and the capability would keep running.

Two smaller ones: a record id this workspace cannot read threw into the error
boundary rather than rendering not-found, and the new-customer form named three
inputs by placeholder alone.

## What was absent, and still is

`contact_facts` has an engine writer and no product surface. `tasks_followups`
has `scheduleFollowUp` and `settleFollowUp`, both tested, and no route calls
either. Those two absences are why two of the pack's ten E2E flows cannot be
driven. See `CRM_FUTURE_BACKLOG.md`.
