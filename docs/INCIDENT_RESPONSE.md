# Incident Response

## Severity

- **SEV-1:** tenant boundary failure, credential disclosure, unauthorized live
  send, destructive data loss, or widespread authentication bypass.
- **SEV-2:** durable processing outage, provider outage with growing queues,
  database degradation, or export/media access failure across workspaces.
- **SEV-3:** isolated workflow/UI failure with a safe workaround.

## First response

1. stop unsafe execution with workspace, automation, conversation and global
   live-send gates;
2. preserve timestamps, request/event IDs, deployment SHA and safe logs;
3. rotate affected credentials through the provider and application vault;
4. revoke sessions/connections if authorization may be affected;
5. quarantine dead letters and do not replay until idempotency is proven;
6. notify the named owner and legal/privacy contact according to policy.

Never paste tokens, customer content, webhook bodies, credential envelopes or
database dumps into tickets or chat.

## Tenant incident

Disable the affected workspace, preserve audit evidence, test the suspected IDOR
with synthetic accounts, verify RLS/Storage policies, and require security
approval before reactivation.

## Duplicate-send incident

Disable live sending, capture the idempotency key/provider message ID, mark
unknown sends as `sent_unknown`, reconcile with the provider, and never blind
retry.

## Closeout

Record root cause, impact, containment, corrective migration/code SHA,
regression test, residual risk and owner acceptance. Update the threat model and
operating rules when the failure pattern could recur.
