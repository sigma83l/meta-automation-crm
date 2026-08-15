# RCOS 12-Step Turn Engine

**Source page:** 12

Every message follows the same auditable pipeline.

1. **Ingest** — event, idempotency, channel, timestamp, media.
2. **Resolve Identity** — provider identity → canonical contact.
3. **Hydrate State** — lifecycle, lead status, owner, facts, consent, tasks, appointment, last outcome.
4. **Policy Gate** — spam/safety/channel window/consent/action permissions.
5. **Understand** — language, multi-intent, entities, urgency, sentiment, objection.
6. **Retrieve** — structured business facts first, then approved RAG.
7. **Decide NBA** — answer/clarify/qualify/recommend/book/follow-up/assign/handoff/close.
8. **Execute Tool** — allowed only; idempotent; authoritative result.
9. **Compose** — concise, language-matched, direct answer before CTA.
10. **Validate** — grounding, unsupported claim, money/time/status, PII, pressure, brand voice.
11. **Commit** — message/action/state events + CRM projections.
12. **Observe** — outcome signal, confidence, telemetry, cost, latency.

## Decision priority

`P0 safety/policy → P1 explicit request → P2 preserve context → P3 move to outcome → P4 improve qualification → P5 nice-to-have learning`

## Single-send pseudocode

```text
assert_deduplicated(event.id)
ctx = resolve_identity_and_state(event)
policy = evaluate_policy(ctx)
if policy.blocked: return safe_resolution(policy)
nlu = understand_structured(event, ctx)
facts = retrieve_approved_facts(nlu, ctx)
decision = choose_next_best_action(nlu, facts, ctx, policy)
result = execute_allowed_action(decision)
reply = compose_and_validate(nlu, facts, result, ctx, policy)
commit_events_and_projections(event, nlu, decision, result, reply)
return send_once(reply)
```
