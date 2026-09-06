# Runbook — AI Provider Incident

**Source pages:** 13–16, 30–31, 41

1. Detect provider error/token spike/escalation ratio/validator failure.
2. Keep RCOS policy and deterministic paths active.
3. Use bounded retry only.
4. Use approved fallback model/provider only if configured.
5. Enforce single-send guard across failover.
6. Never bypass money/time/status/tool-grounding rules.
7. Prefer human handoff or safe waiting state when confidence falls below threshold.
8. Record route reason, retries, model, latency, validation result, outcome reference.
