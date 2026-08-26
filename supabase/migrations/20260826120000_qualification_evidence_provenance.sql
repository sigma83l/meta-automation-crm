-- Qualification evidence must name its source.
--
-- The pack's rule for the score engine is that every non-zero contribution maps
-- to evidence. `qualification_evidence.evidence_ref` was created nullable, which
-- permits a row carrying weight that nothing can justify - and a score built
-- from such a row is the "opinion" the table's own comment says it exists to
-- prevent. A zero weight is exempt: recording that a signal was looked for and
-- found absent is legitimate and contributes nothing either way.
--
-- Safe to add now precisely because the table has never been written to. No
-- TypeScript referenced it until this change, so there are no rows to backfill
-- and no writer to break. Adding the same constraint after the score engine
-- starts filling the table would mean choosing between deleting evidence and
-- inventing provenance for it.

alter table public.qualification_evidence
  drop constraint if exists qualification_evidence_provenance_check;
alter table public.qualification_evidence
  add constraint qualification_evidence_provenance_check check (
    weight = 0 or (evidence_ref is not null and char_length(evidence_ref) between 1 and 200)
  );

-- The score engine reads one customer's current evidence, newest first. The
-- existing index is (workspace_id, recorded_at desc), which serves a
-- workspace-wide recent feed and makes the per-customer read a filter over it.
create index if not exists qualification_evidence_workspace_customer_recent
  on public.qualification_evidence (workspace_id, customer_id, recorded_at desc);
