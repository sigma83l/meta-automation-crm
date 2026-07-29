# Fresh migrations only

These are fresh application migrations; donor migration history is never copied.
They apply in timestamp order from Auth/workspace isolation through CRM,
business knowledge/AI, Meta webhooks, automation and the RC OAuth replay
hardening.

The RC compatibility check resets safely to `20260729010000`, applies
`20260729120000_rc_oauth_state_replay.sql` forward, then runs the full pgTAP
suite. Rollback prefers an application rollback because the nonce table is
additive and ignored by the Prompt 6 checkpoint. If schema removal is required,
back up first and use a new reviewed corrective migration; never edit or delete
applied migration history.
