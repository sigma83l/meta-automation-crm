# Staged Production Plan

**Revised 2026-08-26** against `Rellooma_Master_Sequential_Execution_Pack_v1`.

The previous plan (Prompts 0–11) is preserved at the bottom, because it records
what was actually built and the numbered prompts are cited from several reports.
It is no longer the forward plan. The Master Pack replaces it.

## Governing sequence

Six immutable packs, dependency-ordered. A pack advances only when it earns its
own terminal token, hard-fails clear, P0/P1/material-P2 at zero, evidence
complete, and Git = CI = Preview at one SHA.

| #   | Pack                                              | Terminal token                                                                        |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | CRM Intelligence Engine                           | `READY_FOR_V19A_CONTINUATION_WITH_CRM_ENGINE_FROZEN`                                  |
| 2   | Settings + Billing Sandbox + Knowledge + Commerce | `READY_FOR_V19A_CONTINUATION_WITH_SETTINGS_BILLING_KNOWLEDGE_FROZEN`                  |
| 3   | AI Orchestration Engine                           | `READY_FOR_V19A_CONTINUATION_WITH_RELLOOMA_AI_ENGINE_FROZEN`                          |
| 4   | Analyzer Intelligence                             | `READY_FOR_V19A_CONTINUATION_WITH_ANALYZER_FROZEN`                                    |
| 5   | Final Product Code Quality + Full Sync            | `READY_FOR_V19A_FINAL_BACKEND_PUBLIC_LAUNCH_CONTINUATION_WITH_PRODUCT_QUALITY_FROZEN` |
| 6   | v19A Pre-Legal Technical Production Finisher      | `READY_FOR_LEGAL_PROVIDER_LIVE_ACTIVATION_WITH_V19A_TECHNICAL_BASELINE`               |

Master terminal:
`READY_FOR_VERIFIED_LEGAL_PROVIDER_VALUES_AND_FINAL_LIVE_ACTIVATION_GATE`.

Source integrity verified 2026-08-26: `scripts/verify_master_pack.py` reports
6/6 packs matching `ORIGINAL_SHA256SUMS.txt`.

## Three conflicts to settle before Pack 01 starts

These are not blockers for planning, but two of them change what "execute the
pack as written" means.

**1. The pack names a repository this is not.** Every pack observes
`Metric-One/rellooma-app` on branch `feat/rellooma-ui-production-sync` at
`8e10687991a8bce5edeac72b883d11cccf1ef272`. This repository is
`meta-automation-crm`; that SHA resolves to nothing here, and the nearest branch
is `feat/rellooma-uiux-final-sync`.

The _code_ the packs describe is unmistakably this code — `createBusinessProfileRuntime()`,
the exact `BusinessProfile` field list, the six-field `PriceItem`, and
`@e965/xlsx` / `file-type` / `fflate` / Zod all present at the stated versions.
So the packs were authored against this codebase under a different remote name.

The pack resolves this itself: current repository truth overrides stale
historical assumption, and build-time SHAs are "resume hints unless the Pack
explicitly proves they are still current authority". Proceed against this repo
and this HEAD. **Owner decision needed only if a rename to `rellooma-app` is
actually planned**, since that changes remotes, Vercel wiring and callback URLs.

**2. Commercial values conflict with the prior pricing analysis.**
`02_settings/authority/04_COMMERCIAL_CONTRACT.md` fixes Starter $49 / Growth $99
/ Scale $199 monthly, with MAC + AI-reply + seat meters, capacity packs at $19,
seats at $15, assisted launch at $199. Earlier analysis in this project
recommended a TRY-denominated 799 / 1999 / 4499 structure for the Turkish
market. These are different currencies and different ratios, and the catalogue
can only hold one. **Owner decision.** The pack is canonical unless overridden.

**3. Two packs now exist.** `Rellooma_V1_Backend_Launch_MD_Pack/` governed the
Prompt 0–11 plan; this Master Pack governs from here. The older pack stays for
reference — `CONFLICT_REGISTER.md` C-001…C-014 still cite it — but it is not the
forward plan. Where they disagree, the Master Pack wins.

## Where the current repository already sits

Verified against the schema and routes on 2026-08-26, not from prior reports.

**Substantially built and proven in production:** inbound Meta pipeline end to
end (signature → normalise → ingest → direct dispatch → projection → 12-step turn
→ validator → gated send), workspace isolation and RLS, CRM/inbox/exports,
business profile and knowledge, five automation recipes, billing seam with PayTR
and the Paddle catalogue, analytics taxonomy, email/support seam, en/tr/fa with
RTL, and a live-model golden set.

**Tables the packs require that already exist:** `contact_facts`,
`opportunities`, `qualification_evidence`, `lifecycle_events`, `tasks_followups`,
`custom_field_definitions`, `agent_runs`, `billing_cycles`, `usage_ledger`,
`support_tickets`.

**Present but unwired — no TypeScript reads or writes them:** `opportunities`,
`qualification_evidence`, `lifecycle_events`, `tasks_followups`,
`custom_field_definitions`, `agent_runs`, `campaign_sources`. The pure domain
logic for the first four exists and is tested (`revenue-state.ts`,
`followup-policy.ts`, `handoff-packet.ts`) and is called by nothing but its own
tests. This, not the data model, is Pack 01's real gap.

**Required and absent:** `appointments`, `conversion_events`,
`attribution_touchpoints`, `crm_score_configs`, `crm_score_snapshots`,
`crm_next_action_projection`, `crm_saved_views`, `knowledge_sources`,
`entitlements`, `deletion_ledger`, `action_logs`. Corrected 2026-08-26:
`custom_field_values` was on this list and exists as
`customer_custom_field_values`. The list is a dated snapshot and stays as
written; three of it have since been built by Pack 01 — `crm_score_configs`
and `crm_score_snapshots` in step 2, `crm_next_action_projection` in step 4.

**Routes absent:** Studio, Usage Center, Catalog, Knowledge.

## Pack-by-pack: what is new work

### Pack 01 — CRM Intelligence Engine

Canonical customer memory, explainable revenue state, evidence-backed next
action. Chain: `Conversation → Memory → Decision → Action → Outcome`.

New: qualification score engine with versioned configs and snapshots; attention
/priority engine; next-action projection; saved views; custom field _values_
(definitions exist); timeline event model; the AI CRM write engine.

**Done — customer memory now persists.** `contact_facts` was already shaped for
`memory-policy.ts`'s `StoredFact`, column for column and confidence for
confidence, and nothing in TypeScript touched it: `runTurn` applied the policy,
counted the writes it accepted, and discarded them. The turn ports now hydrate
from the table, and a `persistFacts` port stores what the policy accepts, before
the commit so a crash re-runs the turn rather than leaving a record claiming a
fact that exists nowhere. It reports a count instead of throwing — a storage
failure costs the turn its memory, not the customer their reply — and a short
count becomes `memory_write_failed` on the turn record.

This also corrected a stale claim: the table was recorded as absent in both this
plan and `REPO_BASELINE.md`, and had in fact landed in
`20260815150000_crm_revenue_state.sql`. The baseline's drift section now says so,
along with the four other tables that list gets wrong.

**The rest of the pack is planned in `docs/master-run/PACK_01_PLAN.md`**, written
against the pack's own authority, backend, product and test layers after
verifying its integrity (6/6 SHA match) and re-deriving the repository position
from the schema. Eight steps, backend first.

**Done — step 1, the tables that already existed are wired.**
`qualification_evidence`, `lifecycle_events`, `tasks_followups`, `opportunities`
and the custom field pair each had a schema and no writer. Each now has one, and
in every case the writer arrived with the rule that makes the stored row
trustworthy rather than after it: a transition names its reason and actor, a
follow-up names an owner and can defer, a win names who declared it and what it
rests on, and a custom field value has to be the type its definition declares
and to come from a writer that field permits.

Two of those gates went in ahead of where the plan filed them. The custom field
`ai_write` permission was step 8's; it is here because adding a writer without it
leaves exactly the hole the rest of step 1 was closing, and doing it later means
opening the same seam twice.

**Done — step 2, the qualification score engine.** `crm_score_configs` and
`crm_score_snapshots` are both append-only, which is the whole design: an
editable config version makes every snapshot citing it misreport how it was
computed, and an editable snapshot destroys the history rather than correcting
it. Evidence gained a `component`, because `signal` is the workspace's own
vocabulary and the eight scored areas are fixed by the contract. Determinism is
integer arithmetic rather than a rounding at the end, so a score does not depend
on the order rows come back in.

This also removed `scoreFromEvidence` from `revenue-state.ts`. It returned a
bare number with no components, version or evidence requirement, and keeping it
beside the new engine would have left two scorers and an invitation to call the
one that cannot explain itself.

**Done — step 3, attention priority**, and the lead status vocabulary it needed.
`LEAD_STATUSES` now matches the pack: `needs_reply` and `human_review` added,
`follow_up` renamed to `follow_up_due`, `lost` dropped because the lifecycle
already carries it.

Priority is `Critical | High | Normal | Low` plus reason chips and no 0-100
number. The combination rule is where that could have been quietly broken —
weighting signals and thresholding the sum would rebuild the forbidden number
behind four labels — so the priority is the highest level any single signal
argues for, lowered to the strictest cap in force. Penalties cap rather than
subtract. An explicit request for a person is the one thing never capped, since
every penalty is a reason not to _send_ and that is a request to _look_.

Nothing is persisted; `attentionFor` computes on read. That also keeps it from
landing as another pure module with no caller.

One contract conflict recorded there and settled: the repo's `LEAD_STATUSES`
and the pack's `CRM_LEAD_STATUS_V1` disagree. The pack's set wins — it has
`needs_reply` and `human_review`, which are what an operator queue actually
sorts by, and it keeps `lost` in the lifecycle where it belongs instead of in
both places.

**Done — step 4, the next action and the read model.** The split between what
is computed and what is stored is the whole of it. A next action derived from
current state is not persisted — it is a function of what is true right now, so
a row holding it would be a cache with no invalidation and a second answer able
to disagree with the live one. A next action _proposed_ by a model or a person
was made at a time and has to survive until it is accepted, executed or
superseded, so that gets a row. `crm_next_action_projection` holds only those,
and refuses `derived` on the way in.

The derivation reuses the attention engine rather than restating its rules:
attention decides what governs, `proposeNextAction` decides what to do about
it, and the contract's reason codes fall out of that verdict instead of being
re-derived beside it. The one place the two questions come apart is a cap that
only lowers urgency — awaiting customer — where the thing to do is still
whatever the raising reason named, so an unanswered message from a contact
whose move it is ranks Normal and still proposes a reply. A cap that says
nothing is actionable — opted out, closed — governs instead. `close` is in the
vocabulary and is never derived; a quiet week is not a decision.

Settled proposals are kept rather than deleted, because "the model suggested
this and somebody rejected it" is the record that makes a bad suggestion
pattern visible.

`crm_radar_view` supplies the inputs the ranking reads, one row per customer,
and deliberately does not rank. Re-encoding priority in SQL would leave two
implementations to keep in step — how a contact ends up Critical on the list
and Normal on the record — the same drift `record_lifecycle_transition` avoids.
Paging is keyset on the customer's own `(updated_at, id)` rather than an
offset, which shifts under anybody editing a record while somebody else pages
through, and it reads one row past the limit so "is there more" comes from the
same read. `list()` and its `limit(250)` stay until step 5 moves the index onto
this.

**Done — step 5, the index is a queue.** It listed name, company, status and
source for whatever 250 customers came back first. It now shows current need,
lifecycle, status, score, next action with its priority, owner and last
activity, a page at a time from step 4's projection.

The seven views split into two kinds, and keeping them apart is the whole
design. Qualified, Sales-ready, Customers and Recently Active are column
equality. Needs Attention and Follow-up Due are questions about the attention
verdict, whose rules live in TypeScript — so they filter the ranked row and the
read continues when a page comes back short, rather than being restated in SQL.
The alternative fails silently: a contact in the Needs Attention list whose
record screen calls them Normal. The scan is bounded, so a view matching almost
nothing returns a short page and a cursor instead of walking the workspace.

`crm_saved_views` holds a definition, not a query. Every filter is its own
column constrained to a vocabulary the application already fixes, so a
definition this code could not have written is refused by the database and
nothing typed reaches SQL as syntax. A jsonb blob would have been shorter and
would have accepted anything. Defining one is an operator's right rather than a
viewer's, in the policy as well as the code: a saved view is shared furniture.

Current need comes from customer memory under a reserved key, with its
confidence beside it, because the only honest source for what somebody wants is
what they said. Nothing writes that key until step 7, so the column reads
_Unknown_ today — the pack's rule for an unknown, rather than a blank that reads
as nothing to know.

Three limits worth recording. Ordering stays by recency inside every view,
Needs Attention included, because ordering globally by priority would put the
ranking back in SQL; the priority is on every row instead. The Owner column
says You, A teammate or Unassigned, since nothing in this repository can turn a
user id into a name — the member directory is Pack 02's team seats. And the
export button now says Export search: it exports what the search and status
controls select, and the two attention views are decided by a ranking the
export path does not have.

**Done — step 6, the customer record.** It listed every column of every table
it could reach, twelve key/value pairs at a time. That dump is now what only
the Audit section does, where a raw trace of what was recorded is the point.

The Now card renders every field the same way — a value with what backs it, or
_Unknown / needs confirmation_ — and no branch in it can omit a field it has no
value for. Two derivations could each have been quietly invented and were not.
Data confidence is the weakest confidence among the card's remembered values,
not an average and not the score's own 0–1 folded in: one guess in a card read
as a single claim makes the whole thing a guess, and combining two scales would
produce a number neither could defend. Whether anything is late is read off the
attention verdict rather than recomputed, so the due state and the priority chip
beside it cannot disagree. Evidence becomes a link only where a route exists;
a score snapshot has no page yet, so the card names the reference instead of
offering a link that goes nowhere.

The timeline merges the ten tables that recorded what happened. The pack's line
is between what happened and how it happened, so every event says whether it is
routine and the default view leaves those out — collapsed, not dropped, because
the machinery is exactly what somebody debugging a bad reply needs. A score
recomputation that moved nothing is machinery by that test; a score that changed
is history. Events carry a kind and the values a phrasing needs rather than a
finished sentence, since a summary assembled in the merge would only ever be in
one of the three languages.

`attentionFor` now reads one radar row instead of assembling the same state from
five queries, so the list and the record answer "what is going on with this
contact" from one derivation. What the assembly does with conversations,
consents and follow-ups moved to the migration test, where a real engine checks
it.

Two limits. An outbound message's actor is _this workspace_, not a person:
`messages` records that it went out from here and not who wrote it. And the
record's own vocabularies — lifecycle, status, action, timeline kind — now exist
in all three languages; the stored English summaries on activity rows do not,
and are shown as written rather than machine-translated into a claim nobody
made.

Next is step 7, the AI → CRM write engine: the fourteen-step pipeline, of which
the turn engine and the memory policy already hold half. What is new is
structured extraction of qualification evidence, score recomputation, transition
eligibility and next-action computation — and the invariant that must survive it
is the one already load-bearing: the model emits a proposal in an
application-owned schema, never a field path or a query.

### Pack 02 — Settings, Billing Sandbox, Knowledge, Commerce

Canonical business/catalog/knowledge/usage/seat/billing truth.

New: a products-and-services catalog (the pack states plainly that the current
six-field `PriceItem` is too small); catalog import from Excel and Markdown;
knowledge sources including website-URL and document ingestion; Usage Center;
plan and billing surfaces; team seats. Commercial values must live in one
versioned server-owned registry, never scattered across UI code.

Billing Live stays `WAITING_EXTERNAL`.

### Pack 03 — AI Orchestration Engine

Two customer-facing choices: **Rellooma AI** (managed, provider-neutral, router
picks the model — the customer never names one) and **Use my provider** (BYOK
across OpenAI / Anthropic / Gemini).

The rule with teeth: **BYOK traffic must not silently fall back to a
Rellooma-managed provider**, because that changes both the data and the
commercial expectation. Default disabled; a future explicit owner setting may
permit it.

Already aligned: internal classification/extraction/routing calls never
increment the customer-facing meter — `usage-meters.ts` implements exactly this.

New: AI Control Center, AI usage experience, the managed routing layer.
Live send stays false.

### Pack 04 — Analyzer Intelligence

Three workspaces: Business, Customer, Conversation/AI-Operations. Every metric
must carry definition, time anchor, workspace scope, freshness, derivation,
sample size, drilldown and known limitation. No invented forecast, benchmark,
revenue, causality or psychology.

The current `/analytics` page is a small subset of this.

### Pack 05 — Final Product Code Quality + Full Sync

Cross-domain reconciliation: every production-relevant file inventoried, every
user-facing route and state reviewed, every cross-domain contract reconciled,
no P0/P1/material P2, current visual/a11y/i18n/performance/security evidence,
and Git = CI = Preview at one SHA. A numeric score cannot override a hard fail.

### Pack 06 — v19A Pre-Legal Technical Production Finisher

Broad pre-legal closure against the synchronised product: eight-step business
setup, seat policy, subscription/usage policy, AI provider routing policy, CRM
customisation model, an SEO/content intelligence bridge, business knowledge
profile model, and Studio information architecture. Plus the technical baseline —
observability, backup/restore, capacity, and a 1,000-user proof.

Ends technically production-shaped and deliberately not promoted.

## External gates, unchanged by this revision

```
LIVE_SEND=false
META_LIVE=WAITING_EXTERNAL
BILLING_LIVE=WAITING_EXTERNAL
PRODUCTION_PROMOTED=false
PUBLIC_DNS_CUTOVER=NOT_YET
LEGAL=WAITING
OWNER_LIVE_APPROVAL=WAITING
```

Currently open and owner-only: the Meta webhook signature mismatch (Meta signs
with a key that is not the dashboard App Secret — bug report filed), a Paddle
account, the Meta pilot allowlist, and human UAT.

## Superseded plan, retained for citation

The Prompt 0–11 sequence that governed until 2026-08-26. Prompts 0–9 are
implemented; Prompt 10 was the last active stage; Prompt 11 is replaced by the
Master Pack's own live-activation gate.

1. **Prompt 0 — Foundation:** independent repo, donor audit, contracts, sandbox,
   tests, CI, and local checkpoint.
2. **Prompt 1 — Identity and isolation:** Supabase auth, atomic workspace
   creation, RLS, private Storage, and cross-tenant denial tests.
3. **Prompt 2 — CRM and export:** customers, conversations, private media,
   Excel, and complete ZIP.
4. **Prompt 3 — Business knowledge and AI:** structured knowledge, paid default,
   encrypted BYOK, privacy gates.
5. **Prompt 4 — Meta connections:** OAuth/embedded signup contracts, verified
   webhooks, deduplication, and complete sandbox behavior.
6. **Prompt 5 — Automation engine:** durable state machine, policy-before-send,
   idempotency, retries, and three recipes.
7. **Prompt 6 — Owner experience:** resumable onboarding, seven-step recipe
   builder, responsive owner panel, recovery states, accessibility, RTL
   readiness, and full E2E journeys.
8. **Prompt 7 — Release candidate:** security, load, reliability, dependency
   hardening, and release evidence.
9. **Prompt 8R — Autonomous production completion:** recovered RC, independent
   production gaps, two policy-safe recipes, shared abuse controls, roles, CRM
   import, durable handlers, operations/load artifacts.
10. **Prompt 10 — V1/Signal Mirror:** Supabase/security preserved, eight-stage
    setup, en/tr/fa, RTL, Light/Dark/System, V1 route set, provider contracts,
    private GitHub/CI and independent QA.
11. **Prompt 11 — Hosted staging and production (owner-gated):** superseded by
    the Master Pack sequence above.
