# Observability, Logging, and Alerts

**Source page:** 31

## Structured log envelope

```json
{
  "timestamp": "...",
  "env": "production",
  "service": "ai-reply",
  "trace_id": "...",
  "event_id": "...",
  "workspace_ref": "opaque",
  "conversation_ref": "opaque",
  "run_id": "...",
  "status": "ok|error",
  "error_code": "SAFE_CODE",
  "latency_ms": 123,
  "provider": "meta|paddle|ai|resend"
}
```

## Never log by default

- access tokens;
- service-role keys;
- recovery tokens;
- full message bodies;
- phone/email;
- raw provider PII payloads;
- secrets;
- payment-sensitive fields.

## Alert categories

- **Webhooks:** signature failures, ACK latency, duplicate rate, processing lag.
- **Queue:** backlog age, retry storm, dead/failure runs.
- **AI:** context/token spike, escalation ratio, validator failure, unsupported claim, provider error.
- **CRM:** stage drift, identity anomaly, repeated-question rate.
- **Billing:** webhook failure, entitlement mismatch, reconciliation drift.
- **Integrations:** reauth required, degraded provider, send failure rate.
- **Security:** RLS anomaly, brute-force/rate-limit, suspicious admin action.
- **Backup:** last successful DB/storage backup, restore drill failure.
