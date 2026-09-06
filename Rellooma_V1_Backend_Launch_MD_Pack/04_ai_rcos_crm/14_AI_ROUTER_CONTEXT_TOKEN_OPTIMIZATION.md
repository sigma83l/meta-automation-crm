# AI Router, Context Compiler, and Token Optimization

**Source pages:** 13–14

## Central rule

Tokens are internal cost/telemetry. Customer entitlement is MAC / AI Reply / Seat. Rellooma optimizes model routing, context, and cache behind the scenes.

## Context budget targets

| Layer | Target/turn | Rule |
|---|---:|---|
| System + hard policy | 250–400 tokens | short, stable, no business-copy repetition |
| Agent Snapshot cached prefix | 650–1,000 | versioned brand voice + vertical + permissions + tool schema |
| Customer Memory | 120–250 | only decision-changing confirmed/high-confidence facts + provenance |
| Rolling Summary | 120–220 | derived cache; unresolved context/progression |
| Recent relevant turns | 250–600 | usually 2–4 pairs; relevance-aware |
| RAG/business facts | 250–700 | top 2–4 chunks; structured values preferred |
| Live tool state | 80–200 | authoritative status/availability/booking/entitlement |
| Normal total | ≤ ~2,200 | p95 alert near ~3,500; compress/retrieve again |

## Model roles — IDs must be config-only

- **T0 deterministic:** opt-out, hours, exact confirmations, tool-known values; prefer when safe.
- **Utility/small model:** intent, language, extraction, summary, simple rewrite; strict schema.
- **Primary generative:** customer-facing sales/support/qualification.
- **Escalation reasoning:** complex ambiguity or high-value objections only when thresholds justify.
- **Offline evaluator:** golden-set/admin analysis; never default customer reply.

## Optimization rules

- Normal turn target: 0 or 1 generative call; second pass only for low-confidence/risky flows.
- Full transcript per call is prohibited.
- Stable Agent Snapshot uses hash/version and cache-friendly ordering; no customer PII in static cached prefix.
- Limit tool list per intent.
- Use strict structured outputs for intent/entities/decision/tool arguments.
- Money/time/status/availability/booking/entitlement always come from DB/tool.
- Conversation state belongs to Rellooma, not provider request state.
- Review provider-side storage/caching modes against privacy posture.
