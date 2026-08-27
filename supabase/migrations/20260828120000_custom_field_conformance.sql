-- A custom field value has to be what its definition says it is.
--
-- `custom_field_definitions` has declared a `field_type` since the CRM tables
-- were created, and `customer_custom_field_values` has never been checked
-- against it. The value column allows any jsonb string, number or boolean, so a
-- field defined as a number accepts "about 5k" and a date accepts "next
-- Tuesday". Export, filtering and every future read treat those as data.
--
-- The check has to live in a trigger rather than a check constraint because it
-- spans two tables: the value row alone cannot say what it should have been.
--
-- The second column here is `ai_write`, from `CRM_CUSTOM_FIELD_SCHEMA`. An
-- operator-defined field means the operator decides what it holds, and a model
-- filling in "Contract value" from a hopeful message is the field-level version
-- of the overwrite `authorizeMemoryWrite` already refuses globally.

alter table public.custom_field_definitions
  add column if not exists ai_write text not null default 'never';

-- Closed by default, and that default is the point: every field that existed
-- before this migration was created without anyone considering the question, so
-- the safe reading of their silence is no.
alter table public.custom_field_definitions
  drop constraint if exists custom_field_definitions_ai_write_check;
alter table public.custom_field_definitions
  add constraint custom_field_definitions_ai_write_check check (
    ai_write in ('never', 'suggest', 'inferred', 'confirmed_if_authoritative')
  );

-- How the value got here. Without these a corrected field is indistinguishable
-- from an original one, and there is no way to find what a model wrote if its
-- permission later turns out to have been too generous.
alter table public.customer_custom_field_values
  add column if not exists written_by text,
  add column if not exists confidence text,
  add column if not exists source_ref text;

alter table public.customer_custom_field_values
  drop constraint if exists customer_custom_field_values_written_by_check;
alter table public.customer_custom_field_values
  add constraint customer_custom_field_values_written_by_check check (
    written_by is null
    or written_by in ('human', 'ai', 'automation', 'provider', 'system')
  );

alter table public.customer_custom_field_values
  drop constraint if exists customer_custom_field_values_confidence_check;
alter table public.customer_custom_field_values
  add constraint customer_custom_field_values_confidence_check check (
    confidence is null
    or confidence in ('inferred', 'high_confidence', 'confirmed', 'human_verified')
  );

alter table public.customer_custom_field_values
  drop constraint if exists customer_custom_field_values_source_ref_check;
alter table public.customer_custom_field_values
  add constraint customer_custom_field_values_source_ref_check check (
    source_ref is null or char_length(source_ref) between 1 and 200
  );

-- Conformance and authority, enforced for writers this repository does not
-- contain: an import, a backfill, the automation runner. The application
-- refuses both at its boundary, and that boundary is one writer.
create or replace function private.enforce_custom_field_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  definition record;
  expected text;
begin
  select field_key, field_type, ai_write into definition
  from public.custom_field_definitions
  where id = new.definition_id and workspace_id = new.workspace_id;

  if not found then
    -- The foreign key covers this too. Checking it here as well means the
    -- lookup below cannot silently read nulls if that key is ever relaxed.
    raise exception 'custom field definition % is not in workspace %',
      new.definition_id, new.workspace_id;
  end if;

  expected := case definition.field_type
    when 'number' then 'number'
    when 'boolean' then 'boolean'
    else 'string'
  end;

  if jsonb_typeof(new.value) <> expected then
    raise exception '% expects %, got %',
      definition.field_key, definition.field_type, jsonb_typeof(new.value);
  end if;

  -- A calendar date, not a timestamp: storing "when" more precisely than the
  -- operator asked for invents an accuracy nobody entered. The regex fixes the
  -- shape and the cast decides whether the date is real - 2026-02-31 passes the
  -- first and fails the second.
  if definition.field_type = 'date' then
    if (new.value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception '% expects an ISO date (YYYY-MM-DD)', definition.field_key;
    end if;
    begin
      perform (new.value #>> '{}')::date;
    exception when others then
      raise exception '% was given a date that does not exist: %',
        definition.field_key, new.value #>> '{}';
    end;
  end if;

  -- 'suggest' is refused here alongside 'never' for the same reason it is a
  -- distinct outcome in the policy module: a suggestion is not a stored value,
  -- and the table is where stored values live.
  if new.written_by = 'ai' and definition.ai_write in ('never', 'suggest') then
    raise exception '% does not accept a model write (ai_write is %)',
      definition.field_key, definition.ai_write;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_custom_field_value() from public, anon, authenticated;

drop trigger if exists customer_custom_field_values_conform
  on public.customer_custom_field_values;
create trigger customer_custom_field_values_conform
  before insert or update on public.customer_custom_field_values
  for each row execute function private.enforce_custom_field_value();
