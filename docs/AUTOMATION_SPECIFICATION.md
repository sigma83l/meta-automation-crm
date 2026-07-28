# Automation Specification

The engine supports exactly `INSTAGRAM_COMMENT_TO_DM`,
`INSTAGRAM_INBOUND_DM`, and `WHATSAPP_INBOUND`. Provider events are normalized
and deduplicated before runs advance. Browser or AI input cannot open a service
window or select a workspace.

Runs follow `NEW → WELCOME_SENT → COLLECTING_FIELDS → WAITING_FOR_MEDIA →
QUALIFIED → COMPLETED`. Non-terminal states may interrupt to human review,
opt-out, window closed, or failure. Terminal states never transition.

Questions are ordered CRM field keys. Confirmed fields are not asked again; only
the next missing required field is selected. Media is acknowledged through the
private CRM contract. Approved FAQ/price knowledge and confidence are checked.

Comment automation allows one private reply, then waits for the person's DM.
Instagram has no cold-DM path. Trusted WhatsApp inbound opens exactly 24 hours;
outside it, only approved templates with valid opt-in are eligible.

`automation/run.requested` uses workspace concurrency, bounded backoff, durable
waits, and provider limits. Sends reserve idempotency before execution. A crash
after provider acceptance becomes `sent_unknown` and cannot retry until
reconciled.
