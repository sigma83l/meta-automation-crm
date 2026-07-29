# UI State Matrix

| Surface      | Loading                     | Empty                         | Error / denied                     | Provider / conflict                      | Recovery                                   |
| ------------ | --------------------------- | ----------------------------- | ---------------------------------- | ---------------------------------------- | ------------------------------------------ |
| Overview     | Server route transition     | Zero-valued operational cards | Recent error count                 | Disconnected channel lanes               | Next safe action/checklist                 |
| Automations  | Policy/version loading card | Five-recipe prompt            | Viewer/read-only or foreign ID     | Needs setup/reauth/approval/status pills | Safe test, pause, stop queue, last failure |
| CRM          | Customer loading card       | Create/import-first guide     | Viewer/read-only or safe API error | Partial rows retained                    | Retry/edit/import/export request           |
| Inbox        | Conversation loading card   | No conversations              | Foreign conversation omitted       | Human/automation owner and policy state  | Takeover/resume/back                       |
| Integrations | Connection loading card     | Disconnected cards            | Safe operation failure             | Needs reauth/live blocked                | Test/reconnect/disconnect                  |
| Settings     | Server route transition     | Structured defaults           | Inline save failure                | Credential status only                   | Test/rotate/delete                         |
| Onboarding   | Saved progress fetch        | First account step            | Current step remains incomplete    | Channel/AI setup link                    | Resume any unfinished step                 |

Every state uses text plus semantics; color is supplemental. Mutations expose a
status or alert region, remain CSRF protected and fail without tenant authority.
