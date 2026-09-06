# Platform administration console

The staff console at `/admin`. It is the one deliberate exception to this
repository's central rule that every business-owned record is workspace scoped,
so this document is mostly about what that exception costs and what constrains
it.

## Why it is an exception, and what it is not

There is no way to support a multi-tenant product without somebody being able to
read across tenants. What is negotiable is whether that ability is ambient.
Here it is not:

- It is granted per user, as a row in `platform_admins`. No environment
  variable, no email pattern, no "first account wins".
- It carries a role that separates looking from acting.
- Every action it authorises writes a line to an append-only ledger that not
  even `service_role` may edit.
- It confers **no workspace membership**. A platform admin is not an owner of
  anything, so all the existing workspace-scoped policies keep discriminating
  exactly as they did.

## Roles

| Role               | Can                                                            |
| ------------------ | -------------------------------------------------------------- |
| `platform_support` | Read the console; open a read-only view of a workspace         |
| `platform_admin`   | The above, plus suspend/restore, billing overrides, flags, ops |
| `platform_owner`   | The above, plus granting and revoking staff access             |

The split exists for one reason: an admin who could grant staff access could
promote themselves to owner, which would make the distinction decorative.
`tests/unit/platform-admin-authority.test.ts` holds that line.

## Getting the first owner

There is no in-app bootstrap, on purpose. A path that ran inside the
application — an env allowlist, a magic address — would mean one misconfigured
variable in a deployed environment is a cross-tenant superuser, and that class
of mistake does not announce itself.

The account must already exist (sign up normally first), then:

```bash
node --env-file=.env.local scripts/grant-platform-admin.mjs \
  --email you@example.com --role platform_owner --reason "founding owner"

node --env-file=.env.local scripts/grant-platform-admin.mjs --list
```

It needs `SUPABASE_SERVICE_ROLE_KEY`, so running it is already gated on holding
the most privileged credential the deployment has. After that, staff are
managed from `/admin/staff`.

## How authority is established

Two checks, and both have to pass before anything reads customer data:

1. **Identity**, through `current_platform_admin()` asked on the _caller's own_
   session. Not through the service-role client — resolving staff identity with
   a credential that already bypasses row security would leave a correctly
   written `eq()` as the only thing between a customer and the console.
2. **Capability**, through `assertPlatformCapability`, before
   `createPlatformAdminRuntime` hands out the service-role client.

`AGENTS.md` requires a service-role write to receive a trusted resolved
workspace plus an explicit role check. The console has no workspace to resolve —
that is what makes it the exception — so it substitutes the strictly analogous
pair: a trusted resolved staff identity plus an explicit capability check.

A non-staff session gets **404**, not 403, from every `/api/admin/*` route and
every `/admin` page. A customer probing the URL space should not be able to
map the console's shape.

## Cross-workspace reads

Four tables carry a `private.is_platform_admin()` select policy: `workspaces`,
`profiles`, `workspace_memberships`, `workspace_subscriptions`. Everything else
the console reads goes through the service-role client behind an explicit
capability assertion.

That asymmetry is deliberate. Adding `or private.is_platform_admin()` to fifty
workspace-scoped policies would make the staff predicate part of the tenant
isolation guarantee _everywhere_, and one mistake in it would then be a
cross-tenant leak in every table at once. Four is a blast radius somebody can
hold in their head.

## Email addresses

Shown masked (`h•••@gmail.com`) everywhere, including in the bootstrap script's
output. Staff can still search on the full address — the match happens
server-side and only the masked form comes back. What masking removes is the
bulk harvest: a directory screen rendering four hundred plaintext addresses is
one copy-paste from being an export.

## Feature flags

Three layers, resolved by `workspace_feature_enabled()` and nowhere else:

```
archived catalogue entry   → off, always
workspace override         → wins, unless expired
plan default               → wins over the catalogue
catalogue default          → the backstop
```

Application code asks `isFeatureEnabled(client, workspaceId, key)` (or
`loadFeatureMap` for a page gating several sections). Both **fail closed**: a
read error, a missing flag or an unknown key answers `false`, because the
alternative is that a transient blip hands a workspace a capability its plan
never included, and nothing surfaces that until it reaches an invoice.

Currently gated: `crm_import` (`/api/crm/imports`), `crm_export`
(`/api/crm/exports`). The remaining catalogue keys are declared and manageable
but not yet consulted — `src/modules/features/contracts.ts` is the list, and a
unit test keeps it in step with the seeded catalogue.

A blocked feature answers **403 `FEATURE_NOT_ENABLED`**, never 402: a flag staff
switched off is not fixed by a payment, so it must not arrive as a payment
prompt.

## Global switches

`platform_switches` is **deny-biased, and that asymmetry is the design**:

- Off stops a capability everywhere, immediately.
- On asserts nothing. The environment gate, the explicit approval, the recipient
  allowlist and the provider policy all still decide.

So the console can halt a live send and can never start one, which keeps
`AGENTS.md`'s default-deny intact while still giving an operator one lever
during an incident. A blocked switch answers **503**, because retrying later is
the correct response and a 4xx would tell the caller to change their request.

`public_signup` is read through the service-role client in the signup route:
the table grants `SELECT` to `authenticated`, and whoever is signing up is
`anon` by definition.

## Impersonation

A grant records intent and bounds it. It mints no session, changes nobody's
`auth.uid()`, is capped at 60 minutes, requires a reason of at least 8
characters, and expires in the query rather than by a sweep — so a window closes
on its own even if no cleanup job ever runs.

**No write path anywhere consults a grant.** "Read-only" is therefore a property
of the code's shape, not a rule somebody has to keep remembering. While one is
open the workspace screen carries a non-dismissible banner naming the customer.

## Billing overrides

All transitions go through `transition_workspace_subscription`, never around it.
The console offers only the four statuses that function treats as reachable from
any live state (`active`, `past_due`, `suspended`, `canceled`).

Trial extension is the exception, and it needed its own RPC —
`platform_extend_trial` — because moving to `trialing` from `trialing` is an
illegal transition and `trial_consumed_at` is already set, so the existing
function refuses twice over. Those refusals are correct: they are what stops a
workspace cycling cards for endless free trials. The new function does not relax
them. It moves the deadline forward only, caps at 90 days, never clears
`trial_consumed_at`, and refuses a workspace that is not in a trial. **A
workspace still gets one trial ever; staff can only change when it ends.**

## Ops actions

- **Dead letters** can be _acknowledged_, not replayed. A failed run may already
  have produced a provider send whose persistence is unknown, and `AGENTS.md` is
  explicit that such a send is `sent_unknown` and never blindly retried.
- **Outbox requeue** clears `emitted_at` so the five-minute relay picks the row
  up again. The attempt counter is left alone deliberately — it is why the relay
  gives up after ten tries, and resetting it would make a permanently failing
  row loop forever.

## Suspension

`workspaces.status` and `profiles.status` already existed and are both consulted
by `private.is_active_member`, which every workspace-scoped policy is built on.
So a suspension withdraws access at the engine for every table at once, and
restores it the same way. Nothing is deleted; this is not the deletion path.

Suspending an account also ends its sessions globally — without that, a disabled
profile keeps working until the refresh token the browser already holds happens
to expire, which is not what "suspend" means to whoever pressed the button.

## Every action needs a reason

Enforced in three places: the `ReasonAction` component is the console's only
mutation control, each server module validates 3–400 characters, and the ledger
stores what was typed. An action added later cannot forget the reason box,
because there is no other way to post.

## How it looks, and why

The console is styled from the same semantic tokens as the rest of the product
and has no palette of its own — a route that recoloured itself to announce
"admin area" would be the route-specific authorization colour the UI rules
forbid, and colour is the first signal a screenshot, a colour-blind reader or
`forced-colors` loses. What marks this area is what it _says_: the rail names
the scope, and the banner names the customer.

Four decisions are worth keeping written down, because each replaced something
that looked reasonable in isolation and failed at the sizes real data reaches.

**A reason-gated action is closed until it is chosen.** `ReasonAction` renders a
single quiet trigger; the reason field, the extra fields and the confirm button
appear in place when somebody presses it. It used to render expanded, always,
which is fine on a page with one action and untenable in a directory:
`/admin/users` at a hundred people carried two reason boxes and two buttons per
row — four hundred controls, eleven thousand pixels of scroll, and a resting
state of solid red destructive buttons with the columns identifying _who_ each
row is squeezed into the left third. The requirement is unchanged; there is
still no way to post without a reason. Destructive actions keep their two
deliberate presses, and the danger colour now lives on the confirm button
rather than the trigger, so the palette's strongest signal is spent at the
moment of consequence rather than on rows where nothing has happened.

**The rail carries identity and destinations.** A logo, the scope
("All workspaces" and the role holding it) as one line, seven icon links, the
standing note that every action is recorded, and the way back to the person's
own tenant. The two-letter codes (`PL`, `WS`, `FF`, `SY`) are gone: nobody knows
them, they carried nothing the adjacent label did not, and under RTL they read
as debris on the wrong side of it. The recording note stays — unlike a chip
repeating an environment name it is a live warning about what the reader is
about to do, and it is the console's half of the bargain the ledger enforces.

**Every table is a table, in a panel that scrolls.** Native table layout, one
heading per column, logical `text-align: start`, tabular figures down numeric
columns, machine identifiers bidi-isolated, and the row under the cursor
highlighted so the eye can hold a line across eight columns. Names are set in
weight rather than link blue: a directory whose first column is a hundred
underlines has spent the link colour on its least surprising destination.

**The console has its own bottom navigation below 760px.** It had none — the
seven sections were reachable only by typing URLs, and staff read this console
from a phone exactly when something is on fire.

### Visual evidence

`tests/e2e/admin-visual-matrix.spec.ts` renders all seven sections at
EN/TR/FA × Light/Dark × 1440/1024/390 — 144 frames — against deliberately
hostile seeded state: a workspace name at the 80-character ceiling the table
allows, a Persian name that breaks a column in the other direction, a suspended
tenant beside an active one, an unrecovered dead letter, an open impersonation
grant, and a populated ledger. It asserts what a machine can decide (no
horizontal page overflow, exactly one `h1`, no unlabelled control, no failed
image, correct `dir`/`lang`/`theme`) and writes every frame to disk for the
review it cannot perform. Craft still needs a person; what this guarantees is
that the person is looking at a complete set.

Five defects were found by building that matrix rather than by reading the code:

1. **Every reason box past the first had a label pointing at another row.**
   `ReasonAction` derived its DOM `id` from the endpoint and the label, so every
   row of a directory calling the same endpoint produced the same `id` — and
   `htmlFor` resolves to the first match in the document. The screen-reader
   label existed and did nothing, 198 times on one page. Now `useId`.
2. **The overview's list of open customer views ran together into one
   unspaced line.** `.activity-list` styled `article` children only, and both
   this list and the workspace detail's audit list reach for the semantically
   correct `<ul><li>` — which matched no rule at all. The same class of bug as
   the `.analytics-table` one below it, and now both shapes are named.
3. **The People table pushed the page sideways at 390px.** Its status column was
   clipped and its actions column was off-screen entirely.
4. **Four dashboard tiles rendered as underlined blue hyperlinks**, counts
   included: a link inside `.metric-grid` inherits nothing from
   `.metric-grid article`.
5. **The audit ledger's Target column said "Workspace" on every row.** The
   ledger correctly stores only a reference; the console now resolves names at
   read time (`workspaceNamesFor`), so a reviewer can tell the rows apart, and a
   workspace deleted since shows a short form of the reference rather than an
   invented name.

## Coverage

| Test                                              | Proves                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| `tests/migrations/platform-admin-console.test.ts` | RLS, ledger immutability, flag precedence, trial invariants — real engine |
| `tests/unit/platform-admin-authority.test.ts`     | Role/capability rules and fail-closed identity resolution                 |
| `tests/unit/platform-admin-actions.test.ts`       | Write-path guards, bounds, ledger contents, session revocation            |
| `tests/unit/feature-gate.test.ts`                 | The gate fails closed on every failure shape                              |
| `tests/unit/feature-gate-routes.test.ts`          | 403 vs 503 stay distinguishable                                           |
| `tests/e2e/admin-console.spec.ts`                 | 404 for non-staff, column alignment in both directions, the rail's door   |
| `tests/e2e/admin-visual-matrix.spec.ts`           | 144 rendered cells: overflow, headings, labels, direction, theme, locale  |

The migration test runs as `authenticated` with a settable `auth.uid()`. That
role switch is load-bearing: PGlite connects as a superuser, and a superuser
bypasses row security entirely, so a version of it that only set `test.uid`
would report every policy as permissive no matter what the migration said.

## Known gaps

- Only two feature keys are consulted by application code so far; the other
  eight are manageable but inert until wired.
- The directory reads cap at 500 rows with no pagination. Fine at 10–20
  workspaces, not at a thousand.
- `searchUsersByEmail` and `maskedEmailsFor` page through the admin auth API at
  1000 accounts. Both need a cursor before that number is realistic.
- Nothing sweeps expired impersonation grants or feature overrides. Neither
  needs it for correctness — both are filtered at read time — but the rows
  accumulate.
