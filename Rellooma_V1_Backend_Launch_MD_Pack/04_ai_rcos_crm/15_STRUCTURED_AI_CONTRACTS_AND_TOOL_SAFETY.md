# Structured AI Contracts, Memory Writes, and Tool Safety

**Source pages:** 15–16

## Decision input contract

```json
{
  "workspace_id": "server_resolved",
  "conversation_id": "...",
  "locale": "tr-TR|en|fa-IR|future-ar",
  "channel": "instagram|whatsapp",
  "message": {"type": "text|image|voice", "text": "..."},
  "revenue_state": {"lifecycle": "...", "lead_status": "...", "score": 0},
  "memory": [{"key": "service_interest", "value": "...", "confidence": "confirmed", "source": "msg_id"}],
  "open_actions": [],
  "policy": {"can_send": true, "allowed_actions": ["read", "create_task"]},
  "knowledge_refs": [],
  "tool_state": {}
}
```

## Decision output contract

```json
{
  "intents": [{"name": "pricing", "confidence": 0.98}],
  "entities": [],
  "mental_state": "price_checker",
  "answer_intent": "direct_answer_then_optional_next_step",
  "next_best_action": {"type": "answer|clarify|qualify|book|handoff|wait", "reason_codes": []},
  "memory_writes": [{"key": "...", "value": "...", "confidence": "inferred", "source_ref": "..."}],
  "tool_request": null,
  "handoff": null,
  "risk_flags": [],
  "reply_style": {"question_budget": 1, "cta_strength": 0.4}
}
```

## Action safety classes

| Class | Examples | Default policy |
|---|---|---|
| Read-only | approved price, hours, CRM facts | AI allowed |
| Reversible low-risk | tag, inferred field, create task | AI allowed + audit |
| Business transaction | book slot, create payment link | verified inputs + idempotency + provider confirmation |
| Sensitive/exception | refund, large discount, medical/legal promise | human approval |
| Destructive | delete data, revoke account | human/admin only |

## Memory-write rules

- Confirmed facts cannot be overwritten by weaker inference.
- Every fact carries source, confidence, and validity/freshness.
- Human edit is authoritative unless superseded by newer verified data.
- Summary is derived cache, never primary source of truth.
