# Runbook — Meta Reconnect / Reauth

**Source pages:** 11, 30, 41

1. Identify connection state: degraded / reauth_required / policy_blocked / suspended.
2. Preserve conversation/CRM history.
3. Disable unsafe outbound if provider authorization is invalid.
4. Re-run scoped authentication/reconnect flow.
5. Verify provider account mapping and webhook destination.
6. Replay only safe pending work; preserve idempotency and per-conversation order.
7. Confirm delivery/failure projection.
8. Clear incident only after allowlisted end-to-end send/reconnect evidence passes.
