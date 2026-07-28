# Provider Status Matrix

| Provider capability                               | Sandbox                      | Live                             |
| ------------------------------------------------- | ---------------------------- | -------------------------------- |
| Workspace WhatsApp connection                     | Ready, deterministic         | Blocked by Meta assets/review    |
| Workspace Instagram connection                    | Ready, deterministic         | Blocked by Meta assets/review    |
| OAuth/Embedded Signup state and callback contract | Ready                        | Token exchange adapter blocked   |
| Token envelope storage                            | Ready and tested contract    | Requires approved secrets        |
| GET webhook verification                          | Ready                        | Requires deployed verify token   |
| POST signature verification                       | Ready                        | Requires Meta App Secret         |
| Account-to-workspace routing                      | Ready                        | Requires subscribed assets       |
| Deduplication and durable outbox                  | Ready                        | Inngest relay registration later |
| Media download                                    | Interface and metadata ready | Provider download adapter later  |
| Outbound messaging                                | Fake only                    | Explicitly disabled              |

Connection health values are `unknown`, `healthy`, `degraded`, or `expired`.
Lifecycle values are `pending`, `active`, `disabled`, `reauth_required`, and
`disconnected`. Unknown or non-active connections never create normalized
events.
