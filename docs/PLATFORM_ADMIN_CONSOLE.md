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

## Coverage

| Test                                              | Proves                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| `tests/migrations/platform-admin-console.test.ts` | RLS, ledger immutability, flag precedence, trial invariants — real engine |
| `tests/unit/platform-admin-authority.test.ts`     | Role/capability rules and fail-closed identity resolution                 |
| `tests/unit/platform-admin-actions.test.ts`       | Write-path guards, bounds, ledger contents, session revocation            |
| `tests/unit/feature-gate.test.ts`                 | The gate fails closed on every failure shape                              |
| `tests/unit/feature-gate-routes.test.ts`          | 403 vs 503 stay distinguishable                                           |

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
