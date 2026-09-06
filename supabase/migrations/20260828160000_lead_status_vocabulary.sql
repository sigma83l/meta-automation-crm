-- The operational statuses an operator queue actually sorts by.
--
-- `LEAD_STATUSES` in revenue-state.ts and the pack's `CRM_LEAD_STATUS_V1`
-- disagree, and the pack's set is better for a structural reason rather than a
-- stylistic one. `needs_reply` and `human_review` are the two states a queue is
-- ordered by - somebody is waiting on us, and somebody asked for a person - and
-- this column has no way to express either. Everything is either
-- awaiting_customer or nothing.
--
-- `lost` goes the other way. It is a lifecycle terminal and `lifecycle_stage`
-- already carries it, so having it in both places invites exactly the
-- conflation the revenue-state migration opens by warning against: a lost deal
-- is a fact about the relationship, not about what this conversation is waiting
-- on. `closed` replaces it here and means the conversation is done, whatever
-- became of the relationship.
--
-- Safe to change outright: nothing writes this column yet. The rename below is
-- still written as an update rather than assumed, because the default has been
-- filling rows in since the revenue-state migration.

update public.customers set lead_status = 'follow_up_due' where lead_status = 'follow_up';
-- A lost deal keeps its lifecycle stage, which is where that fact belongs. What
-- it loses is a lead status claiming the conversation is still about losing.
update public.customers set lead_status = 'closed' where lead_status = 'lost';

alter table public.customers
  drop constraint if exists customers_lead_status_check;
alter table public.customers
  add constraint customers_lead_status_check check (
    lead_status in (
      'needs_reply', 'awaiting_customer', 'follow_up_due', 'human_review',
      'booked', 'payment_pending', 'closed'
    )
  );

-- The handoff packet copies the status at the moment of handoff, so it carries
-- the same vocabulary and the same two renames.
update public.handoff_packets set lead_status = 'follow_up_due'
  where lead_status = 'follow_up';
update public.handoff_packets set lead_status = 'closed' where lead_status = 'lost';
