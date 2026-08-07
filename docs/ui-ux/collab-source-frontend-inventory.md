# Collaborator frontend source inventory

Date: 2026-08-07

## Source and target

- Source: `Metric-One/meta-automation-crm`
- Source branch: `feat/rellooma-ui-production-sync`
- Source SHA: `c2606512166d35f02dd1f86e0c608bb364a46d12`
- Target: `sigma83l/meta-automation-crm`
- Target base: `release/v1-preview` at `a8cb88687a57b62089b9cbbd631c177f89867809`
- Common ancestor: `7c9a9a5e5265f6528cbfb61edf2e7825c150780f`

The repositories use the same Next.js 16 App Router, React 19, strict TypeScript, CSS-token,
locale/theme, module and Playwright architecture. This makes full frontend tree transfer safe while
keeping target-only backend and authentication safeguards.

## Transfer matrix

| Source path                                                                   | Target path | Action        | Reason                                                                |
| ----------------------------------------------------------------------------- | ----------- | ------------- | --------------------------------------------------------------------- |
| `app/globals.css`                                                             | same        | COPY          | Complete Rellooma tokens, themes, responsive rules, motion and RTL    |
| `app/layout.tsx`                                                              | same        | MERGE         | Rellooma metadata/noindex/icons plus target `ThemeScript`             |
| `app/theme-script.tsx`                                                        | same        | KEEP TARGET   | Target deployment hydration safeguard                                 |
| `app/automations/[id]/page.tsx`                                               | same        | COPY          | Final automation detail/readiness presentation                        |
| `app/crm/[id]/page.tsx`                                                       | same        | COPY          | Final customer context presentation                                   |
| `app/inbox/page.tsx`                                                          | same        | COPY          | Final operator-workbench states                                       |
| `app/onboarding/page.tsx`                                                     | same        | COPY          | Final eight-step shell presentation                                   |
| `app/error.tsx`, `app/not-found.tsx`                                          | same        | COPY          | Branded recovery states                                               |
| `src/lib/i18n/dictionaries.ts`                                                | same        | COPY          | Canonical Rellooma naming in EN/TR/FA                                 |
| `src/modules/auth/ui/auth-form.tsx`                                           | same        | KEEP TARGET   | Existing target captcha hydration behavior; visual contract unchanged |
| `src/modules/auth/ui/auth-shell.tsx`                                          | same        | COPY          | Approved horizontal brand treatment                                   |
| `src/modules/auth/ui/logout-button.tsx`                                       | same        | COPY          | Final localized interaction behavior                                  |
| `src/modules/automations/ui/automation-builder.tsx`                           | same        | COPY          | Builder readiness and feedback UI                                     |
| `src/modules/business-profile/ui/settings-panel.tsx`                          | same        | COPY          | Final settings presentation                                           |
| `src/modules/conversations/takeover-controls.tsx`                             | same        | COPY          | AI/human ownership controls                                           |
| `src/modules/crm/ui/customer-table.tsx`                                       | same        | COPY          | Compact professional customer rows                                    |
| `src/modules/integrations/meta/connections-panel.tsx`                         | same        | COPY          | Provider health/recovery presentation                                 |
| `src/modules/workspaces/ui/brand-lockup.tsx`                                  | same        | COPY          | Canonical approved-logo component                                     |
| `src/modules/workspaces/ui/dashboard-overview.tsx`                            | same        | COPY          | Attention-first Overview                                              |
| `src/modules/workspaces/ui/onboarding-form.tsx`                               | same        | COPY          | Final localized onboarding UI                                         |
| `src/modules/workspaces/ui/workspace-shell.tsx`                               | same        | COPY          | Final shell/navigation/mobile behavior                                |
| `public/brand/*`                                                              | same        | COPY          | Approved web-ready Rellooma assets                                    |
| `tests/e2e/accessibility.spec.ts`                                             | same        | COPY          | WCAG 2.2 representative coverage                                      |
| `tests/e2e/{connections,foundation,i18n-theme,owner-panel,visual-qa}.spec.ts` | same        | COPY          | Final route/theme/RTL/responsive/visual coverage                      |
| `package.json`, `pnpm-lock.yaml`                                              | same        | MERGE/COPY    | Exact axe test dependency and locked graph                            |
| `playwright.config.ts`, `.github/workflows/ci.yml`                            | same        | COPY          | Production-mode visual CI stability                                   |
| `pnpm-workspace.yaml`                                                         | same        | COPY          | Reviewed dependency override used by source gates                     |
| `docs/ui-ux/*`                                                                | same        | COPY + EXTEND | Source design decisions and SHA-traceable evidence                    |
| `app/api/**`, `supabase/**`, `neon/**`, `proxy.ts`                            | same        | KEEP TARGET   | Protected backend semantics                                           |
| `src/lib/env.ts`, `src/lib/health.ts`                                         | same        | KEEP TARGET   | Target deployment/environment behavior                                |
| non-UI `src/modules/**`                                                       | same        | KEEP TARGET   | Business/provider/auth/tenant authority                               |

## Legacy frontend disposition

No separate legacy route tree exists in the target. Shared primitives and route presentation are
replaced in place. The target-only `ThemeScript` is retained because it is an active deployment
safeguard, not legacy UI. Product-facing legacy names are checked after transfer with a repository
brand scan.
