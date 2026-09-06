-- The indexes the customer record reads through.
--
-- The record page asks each of these tables the same question - "everything you
-- have about this one contact, newest first" - and most of them could not
-- answer it without scanning the workspace. The five below are the ones with no
-- index leading with `customer_id`: lifecycle events, opportunities, evidence,
-- score snapshots, contact facts, handoff packets and files already have theirs.
--
-- `07_READ_MODEL_AND_PERFORMANCE.md` asks for indexes based on measured query
-- plans. These are not measured - there is no production data here to measure
-- against - they are the keys the reads in `timelineFor`, `followUpsFor` and
-- the record sections actually use. That is a weaker claim than the pack's and
-- worth saying plainly rather than implying a measurement nobody took.

-- The timeline's largest source by far, and the only index on it leads with
-- conversation: reading one contact's messages meant scanning every message in
-- the workspace.
create index if not exists messages_workspace_customer_recent
  on public.messages (workspace_id, customer_id, sent_at desc);

create index if not exists customer_notes_workspace_customer_recent
  on public.customer_notes (workspace_id, customer_id, created_at desc);

-- The follow-up section reads one contact's, soonest first. The existing index
-- leads with due time, which serves the due-now sweep and not this.
create index if not exists tasks_followups_workspace_customer_due
  on public.tasks_followups (workspace_id, customer_id, due_at);

create index if not exists crm_audit_events_workspace_customer_recent
  on public.crm_audit_events (workspace_id, customer_id, occurred_at desc);

create index if not exists customer_automation_references_workspace_customer
  on public.customer_automation_references (workspace_id, customer_id);

-- Conversations are read per contact by the record and by the Now card's
-- handling state; the existing index orders the whole workspace's.
create index if not exists conversations_workspace_customer_recent
  on public.conversations (workspace_id, customer_id, last_message_at desc);
