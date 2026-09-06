# Pack 01 — CRM Intelligence Engine: execution plan

**Written 2026-08-26**, after reading the Master Pack governance layer and the
whole of Pack 01's authority, backend, product, schema, config and test layers.

Source integrity: `scripts/verify_master_pack.py` reports 6/6 packs matching
`ORIGINAL_SHA256SUMS.txt`. Pack 01's RUN prompt hashes to
`c92936aaba517280629d0472bf28ebbd4bf9b9c7c32c87b26736561367cfa863`, matching
`MASTER_PACK_MANIFEST.json`. The pack was extracted to a scratch directory and
the repository copy is untouched, per `02_IMMUTABILITY_AND_INTEGRITY.md`.

## The finding that shapes everything below

Pack 01 tells you not to trust its own baseline: _"Do not assume the package
baseline still matches current HEAD."_ It does not, and the direction is the
surprise.

The pack's observed baseline describes a CRM whose data layer needs building and
whose UI is a generic record renderer. Half of that is right. **The data layer
is largely built and almost entirely unwired.** Every table in
`20260815150000_crm_revenue_state.sql` — `opportunities`,
`qualification_evidence`, `lifecycle_events`, `tasks_followups`, and until this
week `contact_facts` — exists with constraints, indexes and RLS, and has zero
TypeScript references. The pure domain logic exists too: `revenue-state.ts`
implements the lifecycle and transition rules, `followup-policy.ts` the
follow-up eligibility rules, `handoff-packet.ts` the handoff shape. All three
are unit-tested. None is called by anything except its own test.

So the gap Pack 01 is really asking to close is not "design a CRM data model."
It is **connect the model that is already there to a UI that is already there**,
and build the four genuinely missing pieces. That reframing changes the order of
work and roughly halves it.

### Verified against the schema on 2026-08-26

Present and used: `customers`, `customer_channel_identities`,
`customer_contact_methods`, `customer_consents`, `customer_notes`,
`customer_activities`, `customer_files`, `customer_automation_references`,
`crm_audit_events`, `conversations`, `messages`, `contact_facts` (wired this
week), `customer_custom_field_values`.

Present and **unwired**: `opportunities`, `qualification_evidence`,
`lifecycle_events`, `tasks_followups`, `custom_field_definitions`, `agent_runs`,
`campaign_sources`.

Genuinely absent: `crm_score_configs`, `crm_score_snapshots`,
`crm_next_action_projection`, `crm_saved_views`, `appointments`,
`conversion_events`, `attribution_touchpoints`, `action_logs`.

Note that `custom_field_values` is absent under that name but present as
`customer_custom_field_values`. PLANS.md listed it as missing; that was wrong,
and it is the second such error found in the inherited "absent" lists.

## What the current CRM actually is

**Index** (`app/crm/page.tsx`, `ui/customer-table.tsx`): one table over a
six-field `CustomerSummary` — id, displayName, companyName, status, source,
createdAt. Search over name and company, active/archived filter, viewer
read-only banner. `list()` orders by `updated_at` and caps at 250 rows with no
pagination.

**Record** (`app/crm/[id]/page.tsx`): seven tabs — Overview, Timeline,
Conversations, Files, Automations, Fields & Notes, Audit — rendering raw rows
through a generic `OwnerDataView` that prints up to twelve keys per object with
a regex denylist for secret-shaped column names. `detail()` fetches nine tables
in parallel, unbounded, on every page load.

**Roles**: `WorkspaceRole = owner | admin | operator | viewer` already exists in
`resolve-workspace.ts`, which is exactly the matrix `tests/03_RBAC_MATRIX.json`
requires.

The pack's instruction not to discard working CRUD, import/export, media and
localization behaviour is easy to honour: all of it is sound. What has to go is
the generic renderer, and only where something specific replaces it.

## One contract conflict to settle

`revenue-state.ts` and the pack disagree on operational lead status.

| Repo (`LEAD_STATUSES`) | Pack (`CRM_LEAD_STATUS_V1.json`) |
| ---------------------- | -------------------------------- |
| `awaiting_customer`    | `awaiting_customer`              |
| `follow_up`            | `follow_up_due`                  |
| `booked`               | `booked`                         |
| `payment_pending`      | `payment_pending`                |
| `lost`                 | `closed`                         |
| —                      | `needs_reply`                    |
| —                      | `human_review`                   |

The pack's set is better and the reason is structural: `needs_reply` and
`human_review` are the two statuses an operator queue is actually sorted by, and
the repo has no way to express either. `lost` is the odd one out — it is a
lifecycle terminal, and `LIFECYCLE_STAGES` already carries it, so having it in
both places invites exactly the conflation `revenue-state.ts` opens by warning
against.

**Plan: adopt the pack's set**, rename `follow_up` → `follow_up_due`, drop
`lost` from lead status (lifecycle owns it), and add `needs_reply` and
`human_review`. The pack explicitly permits workspaces to add or rename
operational statuses, so this stays within its contract. No data migration risk:
nothing writes this column yet.

## Order of work

Sequenced so each step is independently shippable and each one makes the next
cheaper. Steps 1–3 are backend with no UI risk; 4–6 are where the record screen
changes.

### 1. Wire the tables that already exist

`opportunities`, `qualification_evidence`, `lifecycle_events`,
`tasks_followups`, `custom_field_definitions`. Repository methods, workspace
scoping, tests. `lifecycle_events` gets its writer from the existing
`authorizeLifecycleTransition`, which already enforces the pack's
evidence-plus-reason-plus-actor rule and currently enforces it for nobody.

Smallest first: `qualification_evidence`, because step 2 reads it.

### 2. Qualification score engine

New: `crm_score_configs`, `crm_score_snapshots`.

Deterministic and versioned, per `backend/03_SCORE_CONTRACT.md`. Default weights
from `CRM_SCORE_CONFIG_V1.json` — intent 25, fit 20, need/pain 15, urgency 10,
financial fit 10, commitment 10, engagement 5, data confidence 5, disqualifiers
0..-100, normalised to 0–100 after disqualifiers.

The two rules with teeth, both from `tests/02_SCORE_GOLDEN_MATRIX.json`: every
non-zero contribution carries an `evidence_ref`, and the same evidence plus the
same config version always produces the same score. A component that cannot name
its evidence contributes zero — not a default, not a guess. The AI extracts
evidence; the server computes the score. Snapshots are immutable and carry
`previous_score`, so "why did this change" is answerable without recomputation.

Recalculation triggers: accepted evidence change, confirmed-fact correction,
evidence expiry, config version change.

### 3. Attention priority

Deliberately not persisted and deliberately not a number. `07_ATTENTION_PRIORITY_ENGINE.md`
is explicit: `Critical | High | Normal | Low` plus reason chips, no fake 0–100.
It is a pure function over current state — overdue follow-up, unread inbound,
waiting on us, human requested, appointment or payment time pressure — with
penalties for awaiting-customer, snoozed, opted-out and terminal states.

Keeping it separate from the qualification score is a hard requirement in both
`05_REVENUE_STATE_MODEL.md` and `07_`, and the two are conflated constantly:
one asks "how good is this lead", the other "what should I do next". A qualified
lead with nothing outstanding is Normal priority, and that is correct.

### 4. Next action + read model

New: `crm_next_action_projection`.

`backend/04_NEXT_ACTION_CONTRACT.md` is emphatic that CRM proposes and never
executes: the projection stores type, reason codes, evidence refs, owner, due,
eligibility and confidence, and execution is delegated to the domain that owns
the send. This repo already has that boundary — `authorizeOutboundSend` and the
outbox — so the rule is inherited rather than built.

The read model (`backend/07_READ_MODEL_AND_PERFORMANCE.md`) is what makes the
index viable: identity, state, score, priority, owner, next action, last
activity, channel, in one server-owned projection. This replaces the current
`limit(250)` with cursor pagination.

### 5. CRM index → Customer Radar

Columns per `13_RECORD_LIST_AND_RADAR_UX.md`: Customer, Current need, Lifecycle,
Status, Score, Next action, Owner, Last activity.

Default views: Needs Attention, All Customers, Follow-up Due, Qualified,
Sales-ready, Customers, Recently Active. Landing on Needs Attention when
attention signals exist, otherwise All Customers.

Saved views (`crm_saved_views`) are server-owned query definitions, workspace
scoped — never a client-supplied filter string reaching the database.

The existing table stays as the accessible, fast base. This adds columns and
views to it rather than replacing it with a grid library.

### 6. Customer record → Now card + sections

The Now card (`03_CUSTOMER_RECORD_NOW_CARD.md`) is the pack's distinctive
element and the one most likely to be built wrong. Its rule: every value links
to evidence where possible, and anything unknown says **Unknown / Needs
confirmation** rather than being omitted or filled in. A card that looks
complete because it hid its gaps is worse than the raw dump it replaces.

Sections become Overview, Timeline, Conversations, Memory, Follow-up,
Automations, Files, Fields & Notes, Audit. Memory and Follow-up are new;
`OwnerDataView` survives only under Audit, where a raw event trace is the point.

Timeline (`09_TIMELINE_EVENT_MODEL.md`) shows messages, notes, tasks, lifecycle
and score changes, bookings, handoffs and memory corrections by default, and
collapses automation internals, retries and telemetry behind a filter.

### 7. AI → CRM write engine

The fourteen-step pipeline in `10_AI_CRM_WRITE_ENGINE.md`. Steps 1–3, 5, 7–9 and
13 already exist in the turn engine and the memory policy: the memory write path
built this week is step 9, and `authorizeMemoryWrite` is step 7. What is new is
structured extraction of qualification evidence (step 4), score recomputation
(10), transition eligibility (11) and next-action computation (12).

The invariant is already load-bearing here and must stay: the model emits a
proposal in an application-owned schema and never a field path or a query.

### 8. Custom fields, then the gates

`custom_field_definitions` exists and `customer_custom_field_values` exists;
what is missing is the definition-driven validation layer and the `ai_write`
permission from `CRM_CUSTOM_FIELD_SCHEMA.json` — `never | suggest | inferred |
confirmed_if_authoritative`. That last one is the field-level version of the
rule the memory policy already enforces globally.

Then the pack's own gates: RBAC matrix across four roles × three contexts × seven
mutations, the two golden matrices, ten E2E flows, the visual matrix at
EN/TR/FA × Light/Dark × 1440/390, and the evidence files under `docs/final-crm/`.

## What I am not doing without a decision from you

**Nothing in the plan above is blocked** — all of it is settled by the pack, the
repo, or both. These three are yours.

1. **The repository identity.** The packs observe `Metric-One/rellooma-app` at a
   SHA that resolves to nothing here. The pack's own rule ("current repository
   truth overrides stale historical assumption") settles execution, and I am
   proceeding against this repo. This needs you only if a rename is actually
   planned, because that moves remotes, Vercel wiring and Meta callback URLs.

2. **Pricing.** `02_settings` fixes Starter $49 / Growth $99 / Scale $199;
   earlier analysis here recommended 799 / 1999 / 4499 TRY. Pack 02's problem,
   not Pack 01's, but it wants deciding before Pack 02 starts rather than during.

3. **The vendored pack in git.** 78MB of zips, mostly PDFs and a nested
   duplicate of the v19A pack. I have not committed it. The options are: commit
   the ~30KB master scaffolding only and keep the zips local; commit the
   extracted markdown per pack (~350KB each, matching how
   `Rellooma_V1_Backend_Launch_MD_Pack/` is stored today); or commit everything
   and accept the repository weight permanently. **I recommend the second** — it
   matches existing practice, keeps the instructions reviewable in diffs, and
   leaves the byte-immutable zips out of a place where nothing can verify them
   anyway.

## Scope guard

Per `authority/01_SCOPE_AND_FREEZE_EXCEPTION.md`, this pack may touch `/crm`,
CRM-owned modules and components, CRM API routes, CRM migrations and RLS, CRM
integration seams, and CRM tests and docs. It may not touch the shell,
navigation, public site, branding, Inbox, Automation or Settings beyond the
smallest compatible cross-module change, and may not enable live send, alter
billing architecture, or promote production.

`LIVE_SEND=false` and `PRODUCTION=NOT_PROMOTED` hold throughout.
