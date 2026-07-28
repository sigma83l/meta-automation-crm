# Automation Recovery Runbook

1. Pause the workspace, automation, or conversation.
2. Cancel queued steps without deleting evidence.
3. Inspect safe error, provider event, run state, connection, window, and
   idempotency status.
4. Reconcile `sent_unknown` with the provider before any decision; never retry
   blindly.
5. Retry only retryable failures within the bound. Exhausted/permanent failures
   enter dead letter.
6. Correct the cause, then explicitly recover to a new queued attempt.
7. Resume human takeover explicitly and record actor/reason.
8. Verify CRM timeline and audit before removing emergency pause.

Do not copy secrets, message bodies, or media URLs into incident logs.
