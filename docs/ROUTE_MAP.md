# Owner Route Map

| Route                   | Authority                         | Primary action                    | Safe fallback                          |
| ----------------------- | --------------------------------- | --------------------------------- | -------------------------------------- |
| `/signup`               | Anonymous + CAPTCHA               | Create private workspace          | Generic unavailable/rate-limit error   |
| `/login`                | Anonymous                         | Start server session              | Generic invalid/disabled error         |
| `/onboarding`           | Member                            | Resume eight setup milestones     | Preserve last completed step           |
| `/dashboard`            | Active member                     | Continue next safe setup action   | Zero/partial operational metrics       |
| `/automations`          | Active member                     | Create one supported recipe       | Empty list and Sandbox-only notice     |
| `/automations/[id]`     | Active member of owning workspace | Test, activate or emergency pause | Not found for foreign/missing ID       |
| `/crm`                  | Active member                     | Search, edit and export           | Empty/permission/error guidance        |
| `/crm/[id]`             | Active member of owning workspace | Review customer timeline/files    | Not found for foreign/missing ID       |
| `/inbox`                | Active member                     | Select a conversation             | Safe empty list                        |
| `/inbox?conversation=…` | Active member of owning workspace | Take over/resume                  | Mobile back navigation                 |
| `/connections`          | Active member                     | Connect/test Sandbox channel      | Disconnected/reauth/live-blocked state |
| `/settings`             | Active member                     | Save business/AI/data controls    | Inline validation and safe error       |

All protected routes are covered by the session-refresh proxy, including
`/automations`. Browser-supplied workspace IDs never establish authority.
