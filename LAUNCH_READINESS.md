# V1 Launch Readiness — Gate Report

**Assessed:** 2026-08-19 (supersedes the 2026-08-16 assessment)
**Branch:** `feature/v2-platforms` @ `184976b`
**Suite at assessment:** 885 passed / 23 skipped (128 migration tests); typecheck,
lint, format, build, bundle scan and secret scan clean.
**Deployed:** `meta-automation-165gj0neo`, aliased to `app.rellooma.com`.
**Database:** `crm-prod` (`qsvoxpnfxvikannfdybr`), 21/21 migrations applied and
verified at 79/79 relations.

## Terminal status

```
BLOCKED_EXTERNAL
```

Unchanged from 2026-08-16, and for the same reason: five gates need a Paddle
account, a Meta pilot allowlist, a live model provider, a human running the
workflows, and a controlled live send. None of that can be produced from inside
this repository.

What did change is that the previous assessment overstated one thing. It
reported the backend deliverables as "present and tested", which was true
per module and misleading as a whole: the inbound pipeline terminated in a log
table, nothing wrote `conversations` or `messages`, and `runTurn` had no caller
outside its own tests. That gap is now closed, and the gates below say so
specifically rather than crediting it to the modules that were always fine.

## What changed since 2026-08-16

- **The inbound path reaches the CRM and runs a turn.** A verified webhook now
  projects into customer, conversation and message, then executes the twelve-step
  engine against durable Supabase ports. Previously it marked the event
  `processed` and stopped.
- **Migrations are applied to a hosted project.** The 2026-08-16 report's
  "PASS (local)" qualifier existed because no migration had ever run against a
  hosted database. Twenty-one have now run against `crm-prod`.
- **Three defects were found and fixed**, listed under "Defects found" below.
  One of them would have sent blank messages to customers.
- **The environment is live for Meta.** Production runs
  `META_CONNECTION_MODE=live`. This contradicts a documented gate — see
  "Contradiction worth resolving".

## Gates

| Gate                  | Status           | Basis                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0 Repository Truth   | **PASS**         | `REPO_BASELINE.md` plus its dated drift section, `CONFLICT_REGISTER.md`, migration list, test counts                                                                                                                                                                                                                                          |
| G1 Schema & RLS       | **PASS**         | Chain replays from empty; forced RLS and workspace-id index coverage asserted on every browser-readable tenant table; 21/21 applied to `crm-prod` and verified 79/79. Anon refused on the new table and function against production. The full pgTAP suite has still only run locally.                                                         |
| G2 Auth/Account       | **PASS**         | Verification, recovery, provisioning, RBAC and trial state implemented and exercised end to end                                                                                                                                                                                                                                               |
| G3 Meta               | **BLOCKED**      | Needs an allowlisted pilot. Ingest, normalisation, dedupe, reconnect **and now projection** are implemented and tested against fixtures; `scripts/meta-connect-test-number.mjs` can prove the path against Meta's free test assets without review.                                                                                            |
| G4 RCOS/AI            | **PARTIAL**      | The engine, router, validator, context budget and tool safety now run in production against real ports — C-014's wiring is done. Two things remain: no `AI_MODEL_*` is configured, so every turn resolves to a handoff by design, and the golden set (C-013) still needs a live model.                                                        |
| G5 CRM/Automation     | **PASS (local)** | Memory, revenue state, follow-up eligibility and handoff packets implemented and tested. Verified outcome traces need a pilot.                                                                                                                                                                                                                |
| G6 Paddle             | **BLOCKED**      | No account. Signature verification, catalogue, event normalisation, authority and reconciliation ordering are implemented and tested; `docs/PADDLE_SETUP.md` is the wiring checklist.                                                                                                                                                         |
| G7 Usage/Trial        | **PARTIAL**      | Downgraded from PASS (local), deliberately. The ledger's append-only enforcement, meter semantics, caps, trial phases and deletion authorisation are all tested — but nothing writes `billing_cycles`, and `usage_ledger.billing_cycle_id` is NOT NULL, so no usage row can be written at all. The gate's content is correct and unreachable. |
| G8 Site/App Contract  | **PARTIAL**      | Read models built and tested. `/inbox` now shows real conversations and states why a turn stopped. The truth registry and the P5–P9 surfaces are still not on screen.                                                                                                                                                                         |
| G9 Analytics          | **PASS (local)** | Taxonomy, funnel, attribution chain and the PII allowlist boundary implemented and tested                                                                                                                                                                                                                                                     |
| G10 Email/Support     | **PARTIAL**      | Seam, send policy, consent, suppression, tickets and correlation implemented. Delivery evidence needs a provider; auth mail is proven through Supabase.                                                                                                                                                                                       |
| G11 Reliability       | **PARTIAL**      | Security hardening, SSRF guard and the deletion/restore path are implemented. Load, soak, backup-restore drill and runbook rehearsal need an environment.                                                                                                                                                                                     |
| G12 Human UAT         | **BLOCKED**      | Requires a person running owner and operator workflows                                                                                                                                                                                                                                                                                        |
| G13 Allowlisted Pilot | **BLOCKED**      | Requires G3 and a controlled live send                                                                                                                                                                                                                                                                                                        |
| G14 Public Launch     | **BLOCKED**      | Requires every hard gate, an exact SHA, a rollback target and monitoring                                                                                                                                                                                                                                                                      |

"PASS (local)" means the gate's testable content passes here and its evidence
requirement names an environment this repository does not have. G1 lost that
qualifier this round because the environment now exists. G7 gained a PARTIAL it
did not have, because a closer look found its output unreachable rather than
merely unexercised — that is a downgrade on inspection, not a regression.

## Defects found while closing the pipeline

Recorded because each passed every gate in the previous report.

1. **An empty draft passed validation and was sent.** `validateReply` had no
   check that the draft contained text, so the empty string satisfied every rule
   vacuously and `runTurn` recorded `sent`. This is the output the composer
   produces for a provider that is down, a model that is unconfigured, and a
   model that asked for a person — the most travelled failure path in the AI
   layer. Two files documented the opposite behaviour and neither implemented it.
2. **Real customer data could reach a free model tier.**
   `FREE_GEMINI_DEMO_SYNTHETIC_ONLY` is restricted to synthetic data in Demo
   mode, but nothing enforced that on the webhook path. One workspace in
   production is configured in exactly that mode.
3. **The i18n parity test could not fail.** `tr` and `fa` both opened with
   `...en`, so every locale had every key by construction; a missing translation
   rendered English silently. The compiler enforces parity now.

## Blockers, and the smallest owner action for each

Ordered by what unblocks the most. The first two items from the 2026-08-16 list —
pushing the branch and rotating `META_APP_SECRET` — are done.

1. **Choose a model provider and set `AI_MODEL_UTILITY` / `AI_MODEL_PRIMARY`**
   (G4). Until then every turn hands off by design. This is the single change
   that turns the pipeline from proven to useful. The router names no model on
   purpose, so this is configuration, not code.

2. **Prove the Meta path with the test number** (G3). Meta issues a test number,
   a test WABA and a 24-hour token to every app with no verification and no
   review. `scripts/meta-connect-test-number.mjs` stores a connection from them.
   Two prerequisites are recorded under "Environment facts" below.

3. **Create a Paddle account** (G6). Sandbox account, three products with prices,
   a notification destination; then follow `docs/PADDLE_SETUP.md`. Until then
   `PAYMENT_PROVIDER_MODE=paddle` throws by design and the catalogue refuses its
   own placeholder ids.

4. **Get the Meta pilot allowlisted** (G3 → G13). Supply the Embedded Signup
   configuration id and nominate the pilot accounts.

5. **Write a `billing_cycles` opener** (G7). One function that opens or reuses a
   workspace's cycle, so `usage_ledger` becomes writable. Small, internal, and
   nothing else about metering works without it.

## Contradiction worth resolving

Production runs `META_CONNECTION_MODE=live`. `AGENTS.md` and
`scripts/production-preflight.mjs` both require `sandbox`, and the preflight
hard-fails on anything else. One of the two is now wrong: either production
should be returned to sandbox until the pilot is allowlisted, or the documented
gate should be amended to describe what was actually decided. Leaving them in
disagreement means the preflight cannot be run as a check on production, which
removes the value it was written for.

`LIVE_PROVIDER_SEND_ENABLED` remains the gate that matters for outbound, and no
outbound adapter exists in any case.

## Environment facts that block the next step

- **`CREDENTIAL_ENCRYPTION_KEY` is malformed locally** — 17 bytes where
  `decodeMasterKey` requires 32 — so any script storing a provider credential
  throws before reaching the network. Production's value cannot be read back
  (write-only in Vercel) and has never been exercised: `workspace_ai_credentials`
  has zero rows, so nothing has ever encrypted or decrypted with it in any
  environment. Its validity is unproven on both sides, not merely mismatched.
- **Two workspaces exist**, so any script resolving "the" workspace must be told
  which: `business1` (`PLATFORM_PAID_DEFAULT`, English) and `qw`
  (`FREE_GEMINI_DEMO_SYNTHETIC_ONLY`, language `q`, evidently test data). Only
  `business1` can reach a model on the webhook path, by the rule in defect 2.

## What is deliberately absent

Listed because each looks like an omission and is not:

- **No Paddle `PaymentProvider` adapter or webhook route.** A stub that verifies
  no signature is worse than no stub, because it runs.
- **No golden set.** Scoring real prompts needs a live model; asserting expected
  outputs against a model nobody has chosen would be theatre.
- **No memory persistence.** `runTurn` counts accepted and refused memory writes
  and stores neither, because no `contact_facts` table exists (C-007). `hydrate`
  returns an empty set rather than synthesising facts from the conversation,
  which would put unreviewed model output into the store the memory policy
  exists to keep honest. The counters are real; their destination is not built.
- **No outbound send adapter.** `send` authorises and stops. With every gate
  open it throws, so a build without an adapter cannot be mistaken for one that
  works.
- **No materialized views.** Stale figures presented as current are worse than a
  slower query.
- **No mapping between lifecycle stage and lead status.** They answer different
  questions; anything deriving one from the other invents information.
