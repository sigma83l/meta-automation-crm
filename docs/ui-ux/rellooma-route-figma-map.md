# Rellooma route ↔ Figma map

Date: 2026-08-07
Base: `1933ca570734b4ec2fa988f5aa9cbf130dc1ca7f`

The repository route tree is authoritative. The package's 52-screen taxonomy is used only to map
states already supported by these 18 user-facing routes. Figma Desktop exposes `01 Rellooma
Product — 6 Variants` and `02 Rellooma Mobile + RTL + States`, but the MCP quota prevents a
complete node-level inventory; therefore no route is falsely labeled pixel-exact.

| Repository route             | Existing product surface                                  | Figma/package classification |
| ---------------------------- | --------------------------------------------------------- | ---------------------------- |
| `/`                          | Safe product entry redirect                               | `THEME_EXTRAPOLATED`         |
| `/login`                     | Login, invalid/rate-limit/session states                  | `FIGMA_VARIANT`              |
| `/signup`                    | Account/workspace creation and closed signup states       | `FIGMA_VARIANT`              |
| `/forgot-password`           | Recovery request states                                   | `FIGMA_VARIANT`              |
| `/reset-password`            | Recovery completion/session expiry                        | `FIGMA_VARIANT`              |
| `/onboarding`                | Existing resumable eight-step setup                       | `FIGMA_VARIANT`              |
| `/dashboard`                 | Operational overview                                      | `FIGMA_VARIANT`              |
| `/inbox`                     | Queue, active conversation, takeover and blocked composer | `FIGMA_VARIANT`              |
| `/automations`               | Inventory and existing seven-step builder                 | `FIGMA_VARIANT`              |
| `/automations/recipes`       | Existing five-recipe gallery                              | `FIGMA_VARIANT`              |
| `/automations/test-center`   | Existing preview/simulation/readiness evidence            | `FIGMA_VARIANT`              |
| `/automations/[id]`          | Detail, runs, versions, analytics and settings tabs       | `FIGMA_VARIANT`              |
| `/crm`                       | Customer list/search/import/export                        | `FIGMA_VARIANT`              |
| `/crm/[id]`                  | Customer context, timeline, conversations and files       | `FIGMA_VARIANT`              |
| `/analytics`                 | Existing operational counts and definitions               | `FIGMA_VARIANT`              |
| `/connections`               | Instagram/WhatsApp health and recovery                    | `FIGMA_VARIANT`              |
| `/settings`                  | Existing business, knowledge, AI and preference surfaces  | `FIGMA_VARIANT`              |
| `app/error`, `app/not-found` | Recoverable system states                                 | `THEME_EXTRAPOLATED`         |
| `/api/**`, `/auth/callback`  | Non-visual system endpoints                               | `NOT_USER_FACING`            |

## Coverage lock

- User-facing route groups: 18
- Figma/package variants: 15
- Theme-extrapolated: 3
- Not user-facing: API routes and auth callback
- Runtime matrix: EN/TR/FA × Light/Dark
- Required widths: 1440, 1024, 768 and 390

No legal route, broadcast, voice, payment, new channel, new CRM entity or new analytics source is
added by this map. Those surfaces are absent from the current product.
