-- What a follow-up record still needs to be a record rather than a reminder.
--
-- The table already carries the columns that stop it being a timer: objective,
-- cancel_condition and stop_reason are all NOT NULL. Four fields the pack's
-- follow-up contract requires are missing, and each is missing something a
-- caller currently has to guess at.
--
--   owner_type/owner_id  who is responsible for this. A follow-up nobody owns
--                        is one nobody completes, and the distinction between a
--                        human's task and an automation's is the difference
--                        between a queue and a send.
--   last_result          what happened on the last attempt. Without it,
--                        attempts is a number with no story: three attempts
--                        that failed to send and three that were delivered and
--                        ignored are the same row.
--   next_eligible_at     when it may next be tried. evaluateEligibility is
--                        deliberately evaluated at execution, so a refusal that
--                        is not terminal - a human owns the conversation,
--                        sending is off - must leave the row eligible. Without
--                        this column it would be re-read and re-refused on
--                        every sweep, forever.
--
-- Nullable and defaulted throughout: the table has no rows and no writer, but
-- these are additive columns and a forward-safe migration should not depend on
-- that being true.

alter table public.tasks_followups
  add column if not exists owner_type text not null default 'system',
  add column if not exists owner_id uuid references auth.users(id) on delete set null,
  add column if not exists last_result text,
  add column if not exists next_eligible_at timestamptz;

alter table public.tasks_followups
  drop constraint if exists tasks_followups_owner_type_check;
alter table public.tasks_followups
  add constraint tasks_followups_owner_type_check check (
    owner_type in ('human', 'automation', 'ai_suggestion_accepted', 'system')
  );

alter table public.tasks_followups
  drop constraint if exists tasks_followups_last_result_check;
alter table public.tasks_followups
  add constraint tasks_followups_last_result_check check (
    last_result is null or char_length(last_result) between 1 and 200
  );

-- A human owner has to be a person; an automation must not claim to be one.
alter table public.tasks_followups
  drop constraint if exists tasks_followups_owner_identity_check;
alter table public.tasks_followups
  add constraint tasks_followups_owner_identity_check check (
    (owner_type = 'human' and owner_id is not null)
    or (owner_type <> 'human' and owner_id is null)
  );

-- The due sweep reads eligible rows that are due and not deferred. The previous
-- index covered the first two; a deferred row would still be read and then
-- discarded in application code, which is the work this avoids.
drop index if exists public.tasks_followups_due;
create index if not exists tasks_followups_due
  on public.tasks_followups (workspace_id, due_at)
  where eligibility_state = 'eligible';
create index if not exists tasks_followups_next_eligible
  on public.tasks_followups (workspace_id, next_eligible_at)
  where eligibility_state = 'eligible';
