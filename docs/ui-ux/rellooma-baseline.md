# Rellooma UI/UX production baseline

Date: 2026-08-07

## Repository lock

- Repository: `Metric-One/meta-automation-crm`
- Remote: `https://github.com/Metric-One/meta-automation-crm.git`
- Base branch: `release/v1-preview`
- Feature branch: `feat/rellooma-ui-production-sync`
- `BASE_SHA`: `1933ca570734b4ec2fa988f5aa9cbf130dc1ca7f`
- Package manager: `pnpm@11.17.0` (local pnpm `11.16.0`)
- Runtime: Node `v24.16.0`
- Framework: Next.js 16 App Router, React 19, strict TypeScript

The feature branch was created from the clean, current release candidate. A separate outer
working copy contains untracked user files and is intentionally untouched.

## Existing frontend architecture

- Shared authenticated shell: `src/modules/workspaces/ui/workspace-shell.tsx`
- Global design tokens and responsive rules: `app/globals.css`
- Auth shell and forms: `src/modules/auth/ui/*`
- Runtime locale/theme: `app/layout.tsx`, `src/lib/i18n/*`
- Locales: English, Turkish and Persian; Persian uses document-level RTL
- Themes: Light, Dark and System using semantic CSS tokens
- Motion: CSS transitions with a reduced-motion path
- QA: Vitest, Playwright, axe-core, production build and secret scan

## Baseline verification

The identical clean base at `BASE_SHA` passed `pnpm check` before this isolated branch was
created: format, lint, strict typecheck, 87 passing unit/integration tests with 23 skipped,
load-script parsing, 35-page Next.js production build and secret scan.

## Immutable backend guard

The combined SHA-256 over tracked migrations, API routes, shared infrastructure and non-UI
business modules is:

`7062de789bbbfa739eefeb8283a5c21b0ac7efe837885c933a5fbc6349a7d525`

UI work may not change schema/RLS, authentication authority, API contracts, provider semantics,
automation execution, live-send gates, secrets, billing or production data.

## Figma access

- File key: `D48AbyZ4VvSTUuATKm5gp0`
- Reference node: `2005:1351`
- Account: `metricone@manializadeh.com`
- Plan/seat: Starter / View
- MCP result: quota exhausted

Figma Desktop confirms the three Rellooma pages and route/variant naming. Because programmatic
read/write access is unavailable, the package design contract is the visual fallback and screens
without captured evidence are classified `THEME_EXTRAPOLATED`.
