# Owner Route Map

| Route                   | Authority                                 | Primary action                    | Safe fallback                        |
| ----------------------- | ----------------------------------------- | --------------------------------- | ------------------------------------ |
| `/signup`               | Anonymous + CAPTCHA                       | Create private workspace          | Generic unavailable/rate-limit error |
| `/login`                | Anonymous                                 | Start server session              | Generic invalid/disabled error       |
| `/onboarding`           | Member                                    | Resume eight setup milestones     | Preserve last completed step         |
| `/dashboard`            | Active member                             | Continue next safe setup action   | Zero/partial operational metrics     |
| `/automations`          | Operator/Admin/Owner writes; Viewer reads | Create one of five recipes        | Read-only/empty/Sandbox notice       |
| `/automations/[id]`     | Operator/Admin/Owner writes; Viewer reads | Test, activate or emergency pause | Read-only/not found                  |
| `/crm`                  | Operator/Admin/Owner writes; Viewer reads | Search, import, edit and export   | Read-only/empty/error guidance       |
| `/crm/[id]`             | Active member of owning workspace         | Review customer timeline/files    | Not found for foreign/missing ID     |
| `/inbox`                | Active member                             | Select a conversation             | Safe empty list                      |
| `/inbox?conversation=…` | Active member of owning workspace         | Take over/resume                  | Mobile back navigation               |
| `/connections`          | Owner/Admin writes; others read           | Connect/test Sandbox channel      | Read-only/reauth/live-blocked state  |
| `/settings`             | Owner/Admin                               | Save business/AI/data controls    | Permission denied / safe error       |

All protected routes are covered by the session-refresh proxy, including
`/automations`. Browser-supplied workspace IDs never establish authority.
