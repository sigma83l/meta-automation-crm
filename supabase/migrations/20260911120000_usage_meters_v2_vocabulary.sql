-- Widen the usage ledger to the 2026-09-v2 meters.
--
-- `usage_ledger.meter` and `billing_cycles.plan` were both written against the
-- retired 2026-08-v1 model: a count of AI replies, and plans called starter,
-- growth and scale. The catalogue applied on 2026-09-07 meters weighted work
-- units, automation actions and connector units across free, solo, growth,
-- business and agency, and neither constraint would admit a row describing it.
--
-- ## Additive on purpose
--
-- The old values stay permitted. Nothing has written a ledger row yet, so there
-- is no data to migrate today -- but a constraint that drops a value is a
-- constraint that makes historical rows unreadable the moment there are any,
-- and the whole point of an append-only ledger is that an invoice can still be
-- explained years later. `ai_reply` and `automation_action` are retired in the
-- application, which is where retirement belongs; the database's job is to keep
-- being able to read what it was told.

begin;

alter table public.usage_ledger
  drop constraint if exists usage_ledger_meter_check;
alter table public.usage_ledger
  add constraint usage_ledger_meter_check check (
    meter in (
      -- 2026-09-v2.
      'mac',
      'ai_work_units',
      'automation_actions',
      'connector_units',
      'seat',
      'media_bytes',
      -- Retired, still readable.
      'ai_reply',
      'automation_action'
    )
  );

alter table public.billing_cycles
  drop constraint if exists billing_cycles_plan_check;
alter table public.billing_cycles
  add constraint billing_cycles_plan_check check (
    plan in (
      -- 2026-09-v2 tiers.
      'free',
      'solo',
      'growth',
      'business',
      'agency',
      -- Retired, still readable. `growth` appears in both and is deliberately
      -- not duplicated.
      'trial',
      'starter',
      'scale'
    )
  );

-- The index that makes counting distinct MAC contacts cheap names the meter in
-- its predicate, so it is unaffected. Recorded here because a reader checking
-- whether this migration missed an index should find the answer rather than
-- have to work it out.

commit;
