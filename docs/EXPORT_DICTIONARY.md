# CRM Export Dictionary

Every export is scoped by the authenticated user's resolved workspace.

| Sheet              | Contents                                                           |
| ------------------ | ------------------------------------------------------------------ |
| Customers          | Identity, company, status, source and timestamps                   |
| Channel Identities | WhatsApp/Instagram external identities                             |
| Custom Fields      | Field definition references and values                             |
| Consents           | Channel consent and opt-out state                                  |
| Tags               | Customer/tag assignments                                           |
| Conversations      | Channel, state, owner and unread state                             |
| Messages           | Direction, safe body, status and timestamp                         |
| Attachments        | Metadata and relative `attachments/<customer-id>/<safe-name>` path |
| Automations        | Current automation/source references                               |
| Executions         | Foundation execution-compatible references                         |
| Timeline           | Customer activity summaries                                        |
| Export Manifest    | Workspace, generation time, format and file count                  |

Cells beginning with `=`, `+`, `-` or `@` are prefixed with an apostrophe.
Secret-like keys are recursively removed. `manifest.json` lists each included
file path, MIME and checksum. Configured row/file/byte limits apply.
