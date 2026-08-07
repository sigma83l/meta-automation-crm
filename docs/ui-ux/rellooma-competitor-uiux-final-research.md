# Rellooma competitor and adjacent-product UI/UX decisions

Date: 2026-08-07

This is the implementation disposition of the v7 research, not a visual-copy brief. No competitor
trade dress or unsupported capability is adopted.

| Evidence source         | Transferable pattern                                | Rellooma decision                                                                            |
| ----------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Intercom Inbox          | Conversation-first workspace and visible assignment | Preserve queue → active conversation → context; expose AI/human ownership truthfully         |
| Zendesk Agent Workspace | Context persistence and explicit status             | Keep customer context near the thread and explain blocked actions/recovery                   |
| HubSpot Help Desk       | Compact work queue and filters                      | Prefer dense operational rows over oversized cards                                           |
| Linear                  | Fast, visible filters and preserved context         | Keep search/filter state comprehensible; do not invent command features absent from the repo |
| Notion                  | Clear view/filter/sort grammar                      | Use conventional labels and visible applied state                                            |
| Vercel Deployments      | Status, meaning, next action                        | Apply the release hierarchy to connection/readiness states                                   |
| GitHub Actions          | Traceable run history                               | Keep automation run/version/issue evidence explicit and scoped                               |
| Carbon Data Table       | Semantic, keyboard-compatible data density          | Retain the compact CRM table/list and accessible labeling                                    |
| Primer ActionList       | Consistent action identification                    | Keep repeated actions named and styled consistently                                          |
| GOV.UK service guidance | Direct task language and meaningful recovery        | Remove filler; state cause, effect and recovery where known                                  |

## Locked product consequences

- Main navigation remains Overview, Inbox, Automations, Customers/CRM, Analytics, Integrations and
  Settings according to the existing localized route model.
- Inbox prioritizes the working conversation and does not squeeze three columns onto mobile.
- Automations keep test/simulation visually and semantically distinct from Live.
- CRM identity and recent activity precede internal metadata; internal UUIDs are not primary UI.
- Analytics shows stored operational counts only; no decorative or synthetic metrics are added.
- AI remains a capability with ownership/handoff controls, not a sparkle/robot visual brand.
