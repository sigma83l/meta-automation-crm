# CRM security evidence

Recorded 2026-09-03 at `691f10a`.

## The RBAC matrix, executed

`tests/migrations/crm-rbac-matrix.test.ts` runs all 105 cells of the pack's
`03_RBAC_MATRIX` — five roles × three contexts × seven mutations — as real
browser sessions against PGlite with every migration replayed. Each cell runs in
a transaction that is always rolled back, so an allowed write cannot change what
a later cell finds.

The result records three endings, not two:

| Ending      | Meaning                                               |
| ----------- | ----------------------------------------------------- |
| `allowed`   | The write succeeded.                                  |
| `denied`    | A row-security policy refused it.                     |
| `ungranted` | The grant refused it before any policy was consulted. |

`ungranted` is kept separate deliberately. It is the stronger guarantee: a
mistake in a predicate cannot open a table that grants nothing. Collapsing it
into `denied` would hide a table later gaining an insert grant covered by a
policy — the same promise on paper, one predicate away from a leak.

### What the matrix found

- **Owner, admin and operator** may edit a contact, change its status, import
  and export, in their own workspace only.
- **Viewer** is refused every mutation. Read-only, as `AGENTS.md` states.
- **Anonymous** is `ungranted` everywhere: `anon` holds no privilege on any of
  the seven tables, so a signed-out request never reaches a predicate.
- **Forged and cross-workspace** writes are refused for every role including
  owner. A browser-supplied workspace id is a hint and never authority.
- **Three of the seven mutations are `ungranted` for every role**, owner
  included: `contact_facts`, `crm_score_snapshots` and `tasks_followups` grant
  `authenticated` select and nothing more. They are written by engines through
  service role behind an explicit resolved workspace and role check.

## The one opening, and how narrow it is

`settle_next_action` is the only way a browser session writes
`crm_next_action_projection`, and it exists because answering a suggestion is
the one thing a person does to that table. It:

- re-derives authority with `private.can_operate_workspace` on the caller's own
  session, because definer rights bypass row security and whatever it checks is
  the only check there is;
- refuses any outcome but `accepted` and `rejected`;
- locks the row, so two operators answering at once cannot leave a record
  showing only the later one;
- refuses a second answer to a settled proposal;
- changes `settled_at` and `settled_outcome` and, as
  `tests/migrations/settle-next-action.test.ts` asserts by diffing every column,
  nothing else.

A direct update to that table is still denied to every role, which the same file
asserts.

## Entitlement gates

Ten feature flags and five platform switches each have exactly one gate. All
fail closed: an unreadable flag, a missing catalogue row or an unreachable
database reads as off, because the alternative hands a workspace a capability
its plan never included and nothing surfaces that until it appears on an
invoice.

Three gates are deliberately narrower than the flag they read — saved views and
custom fields gate creation but not reading, and the AI reply gate is consulted
after billing so a workspace is told the reason it can act on. An entitlement
decides what may be made, not what may be seen.

## Identity disclosure

A record id that this workspace cannot read renders the application's not-found
state, identically for a contact that never existed and one belonging to another
workspace. A distinct "forbidden" would confirm to whoever guessed an id that it
exists.

## What is not covered here

Cross-tenant isolation for the wider application (storage objects, exports,
webhooks) is `tests/integration/crm-isolation.test.ts` and
`tests/integration/supabase-auth-isolation.test.ts`, which predate this stage
and are unchanged by it.
