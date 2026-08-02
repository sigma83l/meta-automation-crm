# Setup and Onboarding Specification

The setup program is workspace-scoped, page-like, auto-saved on field exit and
resumable from the exact saved stage. Owners may skip non-critical stages,
save/exit into Sandbox and return later.

Stages:

1. workspace name, category, country, timezone, locale and theme;
2. public business profile;
3. customer languages, tone, length, emoji and escalation terms;
4. structured FAQ, price and forbidden claims;
5. Demo/paid/BYOK mode and human-review threshold;
6. Instagram and WhatsApp connection status;
7. one of five policy-safe recipes;
8. deterministic simulation and readiness.

`onboarding_states.stage_data` contains bounded non-secret drafts only. Server
validation rejects credential-like keys. Business profile, settings, FAQ,
price and AI policy updates are applied through a trusted resolved workspace.
Retries update matching structured items rather than creating duplicate setup
facts.

Onboarding completion grants access to Sandbox; it does not imply channel,
provider, policy or Live readiness. Live actions remain disabled with a reason
and next action.
