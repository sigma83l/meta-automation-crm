# CRM data model

Recorded 2026-09-03 at `691f10a`. Tables this pack owns or extended.

## Written by engines only

`authenticated` holds `select`; every write goes through service role behind a
resolved workspace and an explicit role check, or through a named function.

| Table                        | Holds                           | Shape rule that makes a row trustworthy                                                                 |
| ---------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `contact_facts`              | What is known about a contact   | Provenance is `not null`; one row per key per customer; `valid_until` optional                          |
| `qualification_evidence`     | Why a score is what it is       | `evidence_ref` and `component` both required for a row to count                                         |
| `lifecycle_events`           | How a contact reached its stage | Names actor and reason codes, or it is not written                                                      |
| `tasks_followups`            | What somebody owes this contact | Names an owner and a cancel condition; can defer                                                        |
| `opportunities`              | A declared win or loss          | Names who declared it and what it rests on                                                              |
| `crm_score_configs`          | The weights a version means     | **Append-only.** An editable version makes every snapshot citing it misreport                           |
| `crm_score_snapshots`        | One computed score              | **Append-only.** An editable snapshot destroys history rather than correcting it                        |
| `crm_next_action_projection` | Proposals, never derivations    | Refuses `derived`; `settled_at` and `settled_outcome` are both-or-neither; a human owner names a person |

## Written by people, under a policy

| Table                          | Policy                                                                |
| ------------------------------ | --------------------------------------------------------------------- |
| `customers` and its satellites | `can_operate_workspace` for insert/update/delete                      |
| `custom_field_definitions`     | Same, plus an `ai_write` permission per field                         |
| `customer_custom_field_values` | Same; a value must be the type its definition declares                |
| `crm_saved_views`              | Operator to define, member to read — a saved view is shared furniture |
| `export_jobs`                  | `can_operate_workspace`                                               |

## Views and functions

| Object                        | Purpose                                                                    |
| ----------------------------- | -------------------------------------------------------------------------- |
| `crm_radar_view`              | One row per customer: the inputs ranking reads. Deliberately does not rank |
| `record_lifecycle_transition` | Stage and event as one commit, with a concurrency check                    |
| `record_score_snapshot`       | Locks the customer and finds the score this one follows                    |
| `settle_next_action`          | The two settlement columns, for an operator, once                          |
| `workspace_feature_enabled`   | Override → plan → catalogue default, one implementation                    |

## Vocabularies

`LEAD_STATUSES` matches the pack's `CRM_LEAD_STATUS_V1`: `needs_reply`,
`awaiting_customer`, `follow_up_due`, `human_review`, `booked`,
`payment_pending`, `closed`. `lost` lives in the lifecycle, where it belongs,
rather than in both places.

Eight score components plus a disqualifier. Ten next-action types. Four write
classes. Each is fixed by the contract and enforced by a check constraint as
well as a TypeScript union, because a value the database will accept and the
application will not is a value that eventually arrives.

## Corrections to earlier records

`REPO_BASELINE.md` listed `contact_facts` as absent; it landed in
`20260815150000_crm_revenue_state.sql`. `custom_field_values` was listed as
absent and exists as `customer_custom_field_values`. Both are noted in the
baseline's drift section.
