# Automation Engine Migration

Adds sources, automations/immutable versions, triggers, questions, rules,
messages, trusted windows, runs/steps, outbound attempts, idempotency, dead
letters, takeovers, and audit. All tables are workspace-scoped with forced RLS;
browser writes are denied.

Rollback requires pausing automations, cancelling jobs, reconciling
`sent_unknown`, and preserving audit evidence before dropping these tables and
enums.
