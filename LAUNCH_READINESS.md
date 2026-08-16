# V1 Launch Readiness — Gate Report

**Assessed:** 2026-08-16
**Branch:** `feature/v2-platforms`
**Suite at assessment:** 712 passed / 23 skipped (121 migration tests); typecheck, lint, format, build clean.

## Terminal status

```
BLOCKED_EXTERNAL
```

Chosen from the four values the pack permits. It is not
`READY_FOR_OWNER_V1_LAUNCH_ACCEPTANCE`, because that requires G0–G14 all
passing, and five gates cannot pass from inside this repository at all: they
need a Paddle account, a Meta pilot allowlist, a live model provider, a staging
deployment and a human running the workflows. Nothing about the code changes
that, and no amount of further implementation will.

It is not `BACKEND_NOT_READY` either. The backend deliverables in the Definition
of Done are present and tested. What is missing is external.

## Gates

| Gate                  | Status           | Basis                                                                                                                                                                                 |
| --------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0 Repository Truth   | **PASS**         | `REPO_BASELINE.md`, `CONFLICT_REGISTER.md`, migration list, test counts                                                                                                               |
| G1 Schema & RLS       | **PASS (local)** | Chain replays every migration from empty; forced RLS and workspace-id index coverage asserted on every browser-readable tenant table. Needs a staging run to be unqualified.          |
| G2 Auth/Account       | **PASS**         | Verification, recovery, provisioning, RBAC and trial state implemented and exercised end to end                                                                                       |
| G3 Meta               | **BLOCKED**      | Needs a real allowlisted pilot. Ingest, normalisation, dedupe and reconnect are implemented and tested against fixtures.                                                              |
| G4 RCOS/AI            | **PARTIAL**      | Validator, tool safety, router, context budget and the 12-step engine are implemented and tested against injected ports. The golden set (C-013) needs a live model.                   |
| G5 CRM/Automation     | **PASS (local)** | Memory, revenue state, follow-up eligibility and handoff packets implemented and tested. Verified outcome traces need a pilot.                                                        |
| G6 Paddle             | **BLOCKED**      | No account. Signature verification, catalogue, event normalisation, authority and reconciliation ordering are implemented and tested; `docs/PADDLE_SETUP.md` is the wiring checklist. |
| G7 Usage/Trial        | **PASS (local)** | Append-only ledger enforced in Postgres, meter semantics, caps, trial phases and deletion authorisation all tested                                                                    |
| G8 Site/App Contract  | **PARTIAL**      | Read models built and tested. Existing UI surfaces were already bound to real backends. The truth registry and the P5–P9 surfaces are not yet on screen.                              |
| G9 Analytics          | **PASS (local)** | Taxonomy, funnel, attribution chain and the PII allowlist boundary implemented and tested                                                                                             |
| G10 Email/Support     | **PARTIAL**      | Seam, send policy, consent, suppression, tickets and correlation implemented. Delivery evidence needs a provider; auth mail is proven through Supabase.                               |
| G11 Reliability       | **PARTIAL**      | Security hardening, SSRF guard and the deletion/restore path are implemented. Load, soak, backup-restore drill and runbook rehearsal need an environment.                             |
| G12 Human UAT         | **BLOCKED**      | Requires a person running owner and operator workflows                                                                                                                                |
| G13 Allowlisted Pilot | **BLOCKED**      | Requires G3 and a controlled live send                                                                                                                                                |
| G14 Public Launch     | **BLOCKED**      | Requires every hard gate, an exact SHA, a rollback target and monitoring                                                                                                              |

"PASS (local)" means the gate's testable content passes here and its evidence
requirement names an environment this repository does not have. That distinction
is kept deliberately rather than rounded up to PASS.

## Blockers, and the smallest owner action for each

Ordered by what unblocks the most.

1. **Push the branch.** Five commits (P7 slice 1 through P10) sit unpushed on
   `feature/v2-platforms`; P0–P6 are already on `personal`. `git push` is blocked
   by this session's permission layer. Nothing else can be reviewed, deployed or
   promoted until this happens. _Smallest action:_
   `git push personal feature/v2-platforms`.

2. **Rotate `META_APP_SECRET`.** It was pasted into chat earlier in this work and
   must be considered compromised. It is simultaneously the webhook HMAC key and
   the OAuth state signing key, so an attacker holding it can forge inbound
   webhooks and OAuth state. _Smallest action:_ rotate in the Meta dashboard,
   update the Vercel env var. This is the only item on this list that is a live
   security exposure rather than a missing capability.

3. **Fill the legal placeholders.** Production currently serves
   `[LEGAL ENTITY NAME]` and eleven similar placeholders on the terms and privacy
   pages, which are the pages Meta App Review reads. _Smallest action:_ supply
   the twelve values.

4. **Create a Paddle account** (G6). _Smallest action:_ sandbox account, three
   products with prices, a notification destination; then follow
   `docs/PADDLE_SETUP.md`. Until then `PAYMENT_PROVIDER_MODE=paddle` throws by
   design and the catalogue refuses its own placeholder ids.

5. **Get the Meta pilot allowlisted** (G3 → G13). _Smallest action:_ supply the
   Embedded Signup configuration id and nominate the pilot accounts.

6. **Decide C-010 and C-011.** Whether V1 needs in-app support tickets, and
   whether the marketing site is a separate repository — the latter decides
   whether `06_site_backend/` applies here at all.

7. **Choose a model provider** (G4). The golden set cannot be built without one;
   the router deliberately names no model, so this is configuration rather than
   code.

## What is deliberately absent

Listed because each looks like an omission and is not:

- **No Paddle `PaymentProvider` adapter or webhook route.** A stub that verifies
  no signature is worse than no stub, because it runs.
- **No golden set.** Scoring real prompts needs a live model; asserting expected
  outputs against a model nobody has chosen would be theatre.
- **No materialized views.** Stale figures presented as current are worse than a
  slower query.
- **No mapping between lifecycle stage and lead status.** They answer different
  questions; anything deriving one from the other invents information.
- **No UI changes in P10.** There were no mocks to replace, and redesign is
  explicitly out of scope for that phase.
