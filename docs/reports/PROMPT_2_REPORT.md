# Prompt 2 Test Report

## Scope

Workspace-scoped CRM graph, responsive inbox foundation, content-verified
private customer files and authenticated XLSX/ZIP exports.

## Evidence

- Fresh two-migration database reset: pass.
- Database/RLS/Storage pgTAP assertions: 34 pass.
- Unit suites: 22 checks cover media/export plus prior foundation behavior.
- Live integration covers identity, fields, opt-out, messages, timeline,
  cross-tenant CRUD/search/export and Storage denial.
- XLSX and ZIP reopen checks verify 12 sheets, formula neutralization, headers,
  relative file paths, manifest consistency and no secret-shaped content.
- The bundled spreadsheet runtime reopens, scans formula errors and renders the
  Customers sheet for visual review.
- Desktop/mobile CRM journeys cover create, reload, edit, private upload,
  customer export and responsive protected inbox.
- Full E2E suite: 14 pass; client bundle scan: 18 assets pass.
- Production dependency audit has no High or Critical advisory.

## Limits and external work

Exports are synchronous only within configured caps. The durable Inngest event
and dispatcher interface exist, but production worker registration and scheduled
expired-object cleanup require the later infrastructure gate. No provider send,
cloud project or deployment was added.
