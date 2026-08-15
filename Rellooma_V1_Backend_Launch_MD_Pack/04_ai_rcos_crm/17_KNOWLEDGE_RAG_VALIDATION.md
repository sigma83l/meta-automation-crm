# Knowledge, RAG, Validation, and Authoritative Facts

**Source pages:** 12–16, 43–44

## Retrieval order

1. Structured business facts and authoritative DB/tool state.
2. Approved, versioned business knowledge.
3. Relevant RAG chunks.
4. Human/admin clarification when sources conflict or confidence is insufficient.

## Knowledge requirements

- Source owner/version/freshness/validity.
- Contradictory sources trigger clarification/admin alert.
- Retrieval only sends the top relevant content; no full knowledge dump.
- Knowledge cannot override provider/tool authority for booking, payment, entitlement, or status.

## Validator must check

- grounding;
- unsupported/fabricated claims;
- money/time/status/availability/booking;
- PII leakage;
- policy and consent;
- pressure/brand voice;
- tool-permission bypass;
- duplicate-send risk.

## Fail-safe

If an authoritative result is absent, do not claim success. Return a safe resolution or human handoff.
