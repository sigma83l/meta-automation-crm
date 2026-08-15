# RLS, RBAC, and Multi-Tenant Isolation

**Source page:** 9

## Hard invariant

No DB query, API mutation, storage path, job, billing action, or analytics read model may take tenant authority from a browser-editable body/query/header.

`workspace authority = verified session + active membership + server resolver`

## Required controls

- RLS on every exposed tenant table.
- Cross-workspace SELECT/INSERT/UPDATE/DELETE denied.
- Private storage buckets; `storage.objects` policies + workspace-prefixed paths.
- Customer media uses short-lived signed URLs only.
- `resolveWorkspace()` server-side; forged workspace ID ignored/denied.
- Background jobs accept workspace IDs only from trusted server-generated events.
- Browser cannot map arbitrary subscriptions to workspaces.
- Owner/Admin gates for sensitive mutations; MFA readiness + audit.
- Generic analytics uses opaque IDs and no raw message/PII.

## Roles

- **OWNER:** billing, security, delete, team.
- **ADMIN:** settings, integrations, automation, team.
- **OPERATOR:** inbox, CRM, tasks, handoff.
- **VIEWER:** read-only analytics/CRM as configured.

Every role must be tested at API and DB layers, not only hidden in UI.
