-- An outcome has to say who declared it and what it rests on.
--
-- `opportunities` could be marked won by anything that could write the row, with
-- no record of who did it or why. That is the pack's own hard fail - "AI
-- fabricates booking/payment/outcome" - available as an ordinary UPDATE, and it
-- is the most consequential of the four unwired tables to leave open: a won
-- opportunity is revenue as far as everything downstream is concerned.
--
-- The rule is about provenance, not confidence. A model reading "great, I'll
-- take it" has seen enthusiasm rather than a payment, and no amount of
-- certainty promotes an inference into an outcome.
--
-- `ai` is in the source vocabulary rather than omitted from it. A rule enforced
-- by leaving a value out is invisible - the next person to widen the constraint
-- has no idea they are removing a guarantee. Naming the value and refusing it
-- for a win says what is intended.

alter table public.opportunities
  add column if not exists outcome_source text,
  add column if not exists outcome_evidence_ref text,
  add column if not exists outcome_recorded_at timestamptz;

alter table public.opportunities
  drop constraint if exists opportunities_outcome_source_check;
alter table public.opportunities
  add constraint opportunities_outcome_source_check check (
    outcome_source is null
    or outcome_source in ('human', 'ai', 'automation', 'provider', 'system')
  );

alter table public.opportunities
  drop constraint if exists opportunities_outcome_evidence_check;
alter table public.opportunities
  add constraint opportunities_outcome_evidence_check check (
    outcome_evidence_ref is null or char_length(outcome_evidence_ref) between 1 and 200
  );

-- A settled opportunity carries who settled it and when. An open or proposed
-- one carries neither, so reopening a premature close is not itself blocked by
-- the evidence rule - trapping a mistake is worse than allowing its correction.
alter table public.opportunities
  drop constraint if exists opportunities_settled_provenance_check;
alter table public.opportunities
  add constraint opportunities_settled_provenance_check check (
    stage in ('open', 'proposed')
    or (outcome_source is not null and outcome_recorded_at is not null)
  );

-- Only a person or an authoritative provider result may declare a win.
-- 'automation' and 'system' are excluded alongside 'ai': both are this software
-- declaring its own success, which is the same problem under a different name.
alter table public.opportunities
  drop constraint if exists opportunities_win_authority_check;
alter table public.opportunities
  add constraint opportunities_win_authority_check check (
    stage <> 'won'
    or (outcome_source in ('human', 'provider') and outcome_evidence_ref is not null)
  );

-- A loss nobody explained teaches nothing. Any source may observe one - a
-- customer declining, a provider reporting a failed payment, a follow-up budget
-- running out are all real - but the reason is what makes a pipeline of losses
-- worth reading.
alter table public.opportunities
  drop constraint if exists opportunities_lost_reason_required_check;
alter table public.opportunities
  add constraint opportunities_lost_reason_required_check check (
    stage <> 'lost' or lost_reason is not null
  );

create index if not exists opportunities_workspace_customer
  on public.opportunities (workspace_id, customer_id, created_at desc);
