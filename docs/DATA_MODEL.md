# CRM Data Model

All Prompt 2 business tables contain a non-null `workspace_id`. Composite
foreign keys bind related rows to the same workspace, while forced RLS requires
an active membership for every select, insert, update and delete.

## Customer graph

- `customers`: workspace-owned CRM identity and lifecycle.
- `customer_channel_identities`: WhatsApp/Instagram identities.
- `customer_contact_methods`: email and phone methods.
- `customer_consents`: channel consent, lawful basis and opt-out.
- `custom_field_definitions` / `customer_custom_field_values`: typed fields.
- `tags` / `customer_tag_assignments`: workspace tags and assignments.
- `customer_notes`, `customer_activities`: notes and timeline facts.
- `customer_files`: verified private media metadata, checksum and retention.

## Inbox and automation graph

`conversations` stores channel, unread count, human-review state and current
automation/human owner. `messages` stores inbound or prepared outbound content;
Prompt 2 has no provider-send path. `message_attachments` binds messages to
private files. `customer_automation_references` stores safe current/source
references. `crm_audit_events` and `export_jobs` record sensitive actions and
export lifecycle.
