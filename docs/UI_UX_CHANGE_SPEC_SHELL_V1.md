# UI/UX Change Spec — Workspace Shell v1 (navbar, preference controls, loading)

Status: **proposed, not implemented**. No code has been changed by this document.
Written: 2026-09-01. Branch of record: `feature/pack01-crm-intelligence-engine`.
Audience: a human reviewer **and** an AI coding agent executing the change.

---

## 0. How to read this document

- Every change is numbered `C1`…`C6`. Each has **Intent → Current → Target → Edits → Done when**.
- File paths are repo-relative. Line numbers are the state at the time of writing and
  **will drift**; always re-anchor on the quoted selector / JSX text, never on the number.
- `MUST` = required for the change to be accepted. `SHOULD` = strong default, deviate only
  with a note in the PR. `MAY` = optional.
- Blocking prerequisites are in §7. Do not start C6 before resolving `P1`.
- Decisions the author must confirm are in §8. `D1` gates part of C3.

### House constraints this change lives inside

- **No Tailwind, no component library.** All styling is hand-authored CSS in
  `app/globals.css` (3,322 lines) using CSS custom properties.
- **Tokens, not literals.** New rules MUST use existing semantic tokens
  (`--canvas`, `--surface`, `--surface-raised`, `--ink`, `--muted`, `--line`,
  `--line-strong`, `--rail`, `--rail-text`, `--blue`, `--focus`, `--shadow`).
  Do not introduce new hex values in the shell.
- **Theming is token-driven**: `:root` (light) → `[data-theme="dark"]` overrides,
  resolved before first paint by `app/theme-script.tsx`. Any new component MUST read
  correctly in both themes without a component-level `[data-theme="dark"]` override
  unless there is no token that expresses the intent.
- **Three locales, one RTL**: `en`, `tr`, `fa` (`fa` is RTL, see `directionFor` in
  `src/lib/i18n/config.ts`). All new layout MUST use logical properties
  (`margin-inline-start`, `padding-inline`, `inset-inline-end`) — never `left`/`right`.
- **Motion is capped**: `@media (prefers-reduced-motion: reduce)` at `app/globals.css`
  clamps all animation/transition durations to `0.001ms` globally. Any new animation
  MUST also have an explicit reduced-motion resting state (see C6).

### Hazard: unscoped element selectors

`app/globals.css` styles bare `nav { … }` and `nav a { … }` (around L1163–L1200) with
rail-specific rules (dark text colors, 46px rows). These leak into **every** `<nav>` in the
app, including `.mobile-nav`. When editing rail navigation styles you MUST scope new rules
as `.control-rail nav a { … }` and MUST NOT widen the bare-element rules further.

---

## 1. Files in scope

| File                                                                                                                                                                                                                                   | Role in this change                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `src/modules/workspaces/ui/workspace-shell.tsx`                                                                                                                                                                                        | The rail + top bar + mobile nav. Primary target of C1–C4. |
| `src/modules/workspaces/ui/preference-controls.tsx`                                                                                                                                                                                    | Language + theme selects. Target of C2, C5.               |
| `src/modules/workspaces/ui/brand-lockup.tsx`                                                                                                                                                                                           | Logo link. Reused by C6.                                  |
| `app/globals.css`                                                                                                                                                                                                                      | All styling for the above. C1–C6.                         |
| `src/lib/i18n/dictionaries.ts`                                                                                                                                                                                                         | Strings being removed / added. C1–C4, C6.                 |
| `src/components/ui/brand-loader.tsx`                                                                                                                                                                                                   | **NEW** — the loading component. C6.                      |
| `app/dashboard/loading.tsx`, `app/inbox/loading.tsx`, `app/crm/loading.tsx`, `app/automations/loading.tsx`, `app/analytics/loading.tsx`, `app/connections/loading.tsx`, `app/settings/loading.tsx`, `app/settings/billing/loading.tsx` | 8 route loading UIs, all replaced in C6.                  |

### Consumers that MUST keep working

`WorkspaceShell` is rendered by: `app/dashboard/page.tsx` (via `dashboard-overview.tsx`),
`app/inbox/page.tsx`, `app/crm/page.tsx`, `app/crm/[id]/page.tsx`, `app/automations/*`,
`app/analytics/page.tsx`, `app/settings/page.tsx`, `app/connections/*`.
The `active` prop union (`"overview" | "automations" | "crm" | "inbox" | "analytics" | "settings" | "connections"`)
MUST NOT change — changing it is a breaking edit across ~10 call sites.

`PreferenceControls` has **three** call sites with two different presentations:

| Call site                                                | Current usage                    | After this change                                 |
| -------------------------------------------------------- | -------------------------------- | ------------------------------------------------- |
| `src/modules/workspaces/ui/workspace-shell.tsx:120`      | `<PreferenceControls compact />` | replaced by the new icon controls (C2)            |
| `src/modules/auth/ui/auth-shell.tsx:46`                  | `<PreferenceControls compact />` | replaced by the new icon controls (C2)            |
| `src/modules/business-profile/ui/settings-panel.tsx:412` | `<PreferenceControls />`         | **unchanged** — labelled selects stay in Settings |

`BrandLockup` also renders in `app/error.tsx:11` and `app/not-found.tsx:10` — C1 must not
regress those (they call it with no `context` prop, which is the path being kept).

---

## 2. Design rationale (one paragraph, so the intent survives the diff)

The shell currently narrates itself. The rail states the product name, the word "Control",
the word "Workspace", the tenant name, "Private tenant", seven labelled links each prefixed
with a two-letter code, then "Sandbox / Real sending is off". The top bar then restates the
environment as a chip and labels the page with an uppercase eyebrow above the heading.
That is roughly fourteen pieces of standing text competing with the actual page content on
every route. The target is chrome that identifies **where you are** and **what you can do**,
and says nothing else: one logo, one workspace name, seven destinations, and a small cluster
of controls in the top-inline-end corner. Everything removed here is either duplicated
elsewhere, static across the whole session, or an operational state that belongs in the page
body rather than in permanent furniture.

---

## C1 — Simplify the control rail

**Intent:** fewer standing words in the left rail; identity + destinations only.

**Current** (`workspace-shell.tsx:50–93`):

```
<BrandLockup context={t("app.control")} />      ← logo + the word "Control"
<div className="workspace-card">                 ← 3 lines: "Workspace" / name / "Private tenant"
<nav>  7 × ( <span className="nav-glyph">OV</span> + label )   ← 2-letter codes
<div className="safety-lock">                    ← status dot + "Sandbox" / "Real sending is off"
```

**Target:**

```
[logo]
Acme Studio                       ← workspace name only, one line
──────────────────────────────
[icon] Overview
[icon] Inbox
[icon] Automations
[icon] CRM
[icon] Analytics
[icon] Integrations
[icon] Settings
```

**Edits**

1. `workspace-shell.tsx:51` — MUST render `<BrandLockup />` with **no** `context` prop.
   Do not delete the `context` prop from `brand-lockup.tsx`; it is optional and unused
   call sites already pass nothing.
2. `workspace-shell.tsx:52–57` — replace the `.workspace-card` block with a single element:
   `<p className="rail-workspace" title={workspaceName}>{workspaceName}</p>`.
   The strings `t("shell.workspace")` and `t("shell.privateTenant")` are dropped from the rail.
3. `workspace-shell.tsx:58–85` — replace each `<span className="nav-glyph">XX</span>` with an
   icon. Icons MUST be inline `<svg aria-hidden="true" focusable="false">` at 18×18 with
   `stroke="currentColor"`, `fill="none"`, `stroke-width="1.6"` — no icon package, no
   emoji, no image requests. Put them in a new `src/modules/workspaces/ui/nav-icons.tsx`
   exporting one component per destination, so the shell JSX stays readable.
   Suggested glyph semantics: Overview = grid, Inbox = tray, Automations = lightning/flow,
   CRM = people, Analytics = bar chart, Integrations = plug/link, Settings = gear.
   The visible **text label stays** — this is a labelled icon list, not an icon-only rail.
4. `workspace-shell.tsx:87–93` — delete the entire `.safety-lock` block (see also C3).

**CSS** (`app/globals.css`)

- `.workspace-card` (L1140–L1158) → delete; add `.rail-workspace`:
  one line, `color: var(--rail-text)`, `font-size: .83rem`, `font-weight: 650`,
  `padding-inline: 7px`, and `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`
  so a long tenant name cannot break the 248px grid column.
- `.nav-glyph` (L1200) → repurpose as the icon slot: keep the 28×28 box **or** drop the
  border for a cleaner read (SHOULD drop it — the box was scaffolding for the letter codes);
  remove `font-family`/`font-size`/`letter-spacing`, add `flex: none`.
- `.safety-lock`, `.safety-lock > div`, `.safety-lock strong`, `.safety-lock span`
  (L1102–L1112, L1213) → delete. `.status-light` is used elsewhere — **check before deleting**:
  `grep -rn "status-light" app src` and only remove the rule if the rail was the sole user.
- `.control-rail` (L1081) `grid-template-rows: auto auto 1fr auto` → `auto auto 1fr`
  now that the safety lock (the final `auto` row) is gone.
- `.brand-context` (L1134) → keep the rule (other lockup call sites may reuse it) but it
  becomes unused in the rail. MAY delete if `grep -rn "brand-context" app src` shows no
  remaining consumer.
- Responsive: at `@media (max-width: 1050px)` (L1753) the rail collapses to 76px and hides
  `.brand-lockup .brand-context` and `.workspace-card`. Replace the `.workspace-card`
  reference with `.rail-workspace`, and delete the `.safety-lock > div` hide rule.
  At `@media (max-width: 760px)` (L1807) do the same for the `.workspace-card` reference.
  **Leaving stale selectors in the media queries is a silent failure** — the collapsed
  rail will show the full tenant name and overflow.

**Done when**

- The rail contains exactly: logo, workspace name, 7 labelled icon links. Nothing else.
- At ≤1050px the rail is 76px wide, shows icons only, and the workspace name is hidden.
- At ≤760px the rail is the horizontal top strip it is today, with no leftover empty rows.
- Every nav link still exposes its accessible name (the visible label is retained, so no
  `aria-label` is needed; icons are `aria-hidden`).
- `aria-current="page"` still lands on the active destination for all 7 values of `active`.

---

## C2 — Theme and language as small buttons, top-inline-end

**Intent:** move the two preference controls into small icon-sized buttons in the top-right
corner (top-**left** under RTL — use logical properties and this comes free).

**Current** (`workspace-shell.tsx:101–123`): `.topbar-actions` holds, in order —
offline chip, search form, "Notifications" text link, `<PreferenceControls compact />`
(two 40px-tall native `<select>`s with visually-hidden labels), "Sandbox" chip, logout button.
Note that at ≤1050px the media queries **hide** `.topbar .preference-controls` entirely, so
tablet and mobile users currently have no theme or language control in the shell at all.

**Target order** inside `.topbar-actions` (inline-end cluster):

```
[offline chip, only when offline]  [search]  [🔔]  [EN ▾]  [☾]  [Sign out]
```

**Edits**

1. Create `src/modules/workspaces/ui/preference-buttons.tsx` (`"use client"`) exporting
   `PreferenceButtons`. It reuses the persistence logic of `preference-controls.tsx`
   — cookie write, `localStorage`, `document.documentElement.lang/dir`, `applyTheme`,
   CSRF fetch, `PATCH /api/preferences`, `router.refresh()`.
   **Extract that logic once** into `src/modules/workspaces/ui/use-preferences.ts` and have
   **both** `preference-controls.tsx` (Settings) and `preference-buttons.tsx` (shell) call it.
   Two copies of the cookie+CSRF+refresh sequence is the failure mode to avoid here.
2. **Theme button** — a single `<button type="button">` that cycles
   `system → light → dark → system`, preserving the existing three-state model
   (`themes` in `src/lib/i18n/config.ts`). It renders the icon of the **current** preference
   (sun / moon / half-circle for system) and MUST carry
   `aria-label={t("prefs.theme") + ": " + t("prefs." + theme)}` so the state is announced,
   not just the affordance. `title` MAY duplicate it for mouse users.
3. **Language button** — SHOULD be a native `<select>` restyled as a small chip showing the
   2-letter code (`EN` / `TR` / `FA`), keeping the existing `<option>` list. Native select
   gives correct keyboard, mobile and screen-reader behaviour for free and adds no popover
   code. It keeps its visually-hidden `<label>` (the `.preference-controls.compact label > span`
   pattern at L1279 is the existing precedent — reuse that idea, do not reinvent it).
   A custom popover menu is the `MAY` alternative and only if the author asks for it;
   it then MUST implement roving focus, Escape-to-close, and outside-click dismissal.
4. `workspace-shell.tsx:117–119` — the `.topbar-link` "Notifications" text link SHOULD become
   a bell icon button linking to `/dashboard#attention`, with
   `aria-label={t("shell.notifications")}`. This is the "less text" ask applied consistently;
   if the author prefers keeping the word, leave it and note the exception.
5. `workspace-shell.tsx:120` — replace `<PreferenceControls compact />` with
   `<PreferenceButtons />`. Do the same at `src/modules/auth/ui/auth-shell.tsx:46`.
6. `src/modules/business-profile/ui/settings-panel.tsx:412` — **no change**. Settings keeps
   the full labelled selects. This is deliberate: the icon buttons are for speed, the
   settings page is for discovery.

**CSS**

- Add `.icon-button`: 36×36 desktop, **44×44 under `@media (pointer: coarse)`** (the design
  system's stated touch minimum), `border: 1px solid var(--line)`, `border-radius: 9px`,
  `background: var(--surface)`, `color: var(--muted)`; hover → `color: var(--ink)` and
  `border-color: var(--line-strong)`; `:focus-visible` → `outline: 2px solid var(--focus);
outline-offset: 2px`.
  **Do not** let these inherit `.topbar button` (L1363/L1371), which paints every top-bar
  button solid `--blue` — either scope that rule to `.topbar button:not(.icon-button)` or
  give `.icon-button` the winning specificity. Getting this wrong produces three solid blue
  squares in the corner; it is the most likely visual regression in C2.
- Add `.lang-chip` for the select: same box as `.icon-button` but `width: auto`,
  `padding-inline: 9px 22px`, `font-size: .72rem`, `font-weight: 700`,
  `letter-spacing: .04em`, uppercase.
- `.topbar-actions` (L1322) — reduce `gap` to `6px` for the button cluster, or wrap the
  three controls in `<div className="topbar-cluster">` with its own `gap: 6px` while the
  outer gap stays `9px`. The second is cleaner and SHOULD be preferred.
- Responsive: at ≤1050px and ≤760px, **remove** `.topbar .preference-controls` from the
  hide lists and ensure the new controls stay visible. `.global-search` may continue to
  hide. Fixing this is part of C2's acceptance, not a bonus.

**Done when**

- Theme and language sit at the top-inline-end of the top bar on **all** breakpoints.
- Under `dir="rtl"` (`fa`) the cluster renders top-left with no bespoke RTL CSS.
- Both controls are reachable by keyboard, have a visible `:focus-visible` ring, and
  announce their current value.
- Contrast of icon-on-surface is ≥ 4.5:1 in light **and** dark.
- Settings still shows the full labelled selects.

---

## C3 — Remove the Sandbox indicators from the shell

**Intent:** delete the standing "Sandbox" furniture. It is the same word on every route in
two places and carries no per-page information.

**In scope — delete:**

| Location                                                                                    | Content                                                                                                                                                         |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace-shell.tsx:87–93`                                                                 | `.safety-lock` block — `t("shell.safeMode")` + `t("shell.noSend")` (also covered by C1)                                                                         |
| `workspace-shell.tsx:121`                                                                   | `<span className="environment-chip">{t("shell.safeMode")}</span>`                                                                                               |
| `app/globals.css` L1339 `.environment-chip` + L1346 `[data-theme="dark"] .environment-chip` | Keep **only if** `app/onboarding/page.tsx:20` still uses the class (it does today). Verify with `grep -rn "environment-chip" app src` before deleting anything. |

**i18n:** `shell.safeMode` and `shell.noSend` become unused in the shell. Remove the keys
from all three locale maps in `src/lib/i18n/dictionaries.ts` **only after** confirming no
other consumer: `grep -rn "shell.safeMode\|shell.noSend" app src`.

**Out of scope — do NOT touch** (these are product semantics, not chrome; see `D1`):

- `app/onboarding/page.tsx:20` — `onboarding.sandbox` chip.
- `src/modules/integrations/meta/connections-panel.tsx:217–219, 261` — the Sandbox
  connection copy and "Connect sandbox" action.
- `app/automations/test-center/page.tsx:13, 50–51` — sandbox as an evidence class.
- `app/analytics/page.tsx:45–46` — "Inbound and sandbox outbound message rows".
- `src/modules/workspaces/ui/dashboard-overview.tsx` — the brief copy mentioning a
  Sandbox test.
- Everything under `src/modules/integrations/meta/sandbox-adapter.ts`,
  `src/modules/billing/*`, `src/lib/env.ts`, `src/lib/inngest/*` — **runtime behaviour.**
  Nothing in this document changes whether the app can send real messages.

**Done when:** no shell chrome renders the word "Sandbox" on any route; onboarding,
connections, test-center and analytics are byte-identical.

---

## C4 — Remove the text above "Overview"

**Intent:** the page heading stands alone.

**Current** (`workspace-shell.tsx:97–100`):

```tsx
<div>
  <span className="eyebrow">{t("shell.workspaceData")}</span> ← "Workspace operations"
  <h1>{title}</h1> ← "Overview"
</div>
```

**Edits**

1. Delete the `<span className="eyebrow">` line. Keep the wrapping `<div>` (it is the
   flex child that pushes `.topbar-actions` to the inline end via `margin-inline-start: auto`);
   if you unwrap it, the layout breaks.
2. `.topbar h1` (L1307) — `margin: 2px 0 0` → `margin: 0`, since it no longer sits under a label.
3. `.eyebrow` (L1313) is used elsewhere (`dashboard-overview.tsx:46`, other page intros).
   **Keep the rule.** Only `shell.workspaceData` becomes unused — remove that key from all
   three locale maps after `grep -rn "shell.workspaceData" app src` comes back empty.

**Done when:** the top bar shows the page title as the first and only text on its inline-start
side, on all 7 routes, and `.topbar` keeps its 72px min-height without collapsing.

---

## C5 — Language change re-renders behind the loading component

**Intent:** changing language shows the brand loader, then reveals the newly-translated page.

**Why the current code does not do this.** `persist()` in `preference-controls.tsx` ends with
`router.refresh()`. A refresh re-renders Server Components in place; it does **not** unmount
the tree and does **not** trigger any `loading.tsx` boundary. Today the only feedback is
`disabled` on the two selects. There is no code path where a route-level loading file will
appear on a locale change — so the loader must be rendered by the control itself.

**Target behaviour**

1. User picks a locale.
2. Cookie + `localStorage` + `<html lang>` + `<html dir>` are set immediately (already done).
3. A full-viewport `<BrandLoader />` overlay fades in over the app.
4. `router.refresh()` runs inside a React transition; the server re-renders every Server
   Component with the new locale cookie.
5. When the transition settles, the overlay fades out and the translated page is revealed.

**Edits** (in the shared `use-preferences.ts` from C2, so Settings gets the same behaviour)

- Wrap the refresh in `useTransition`:
  ```
  const [pending, startTransition] = useTransition();
  …
  startTransition(() => router.refresh());
  ```
  Keep the existing `busy` state for the network writes (CSRF + `PATCH /api/preferences`)
  and expose `loading = busy || pending` to the caller.
- Render the overlay from the preference component when `loading` is true:
  `{loading ? <BrandLoader variant="overlay" /> : null}`.
- Locale change MUST show the overlay. Theme change SHOULD NOT — theme is applied
  synchronously by `applyTheme()` on `document.documentElement` and needs no re-render
  curtain. Track which control fired and only raise the overlay for locale.
- Keep the controls `disabled` while `loading` so a second switch cannot interleave.
- The `PATCH /api/preferences` call is already `.catch(() => undefined)`. Preserve that:
  a failed persist must not strand the user under a permanent overlay. The overlay's
  lifetime MUST be tied to the transition, not to the fetch.
- `dir` flips when entering or leaving `fa`. `router.refresh()` keeps the DOM, and the
  `dir` attribute is already set imperatively before the refresh, so mirroring is correct.
  If QA finds layout artefacts on the `en ⇄ fa` switch specifically, the sanctioned
  fallback is `window.location.assign(window.location.href)` for direction-changing
  switches only — which does produce a real document load and does show the loader. Try
  the transition first; do not reach for the reload by default.

**"Lazy loading" note.** The literal ask is "reload the page with lazy loading". Dictionaries
in `src/lib/i18n/dictionaries.ts` are one static module holding all three locales and are
imported by both server and client — they are already in every bundle. Genuinely lazy-loading
a locale (dynamic `import()` per locale, so `tr` and `fa` strings leave the `en` bundle) is a
**separate, larger change** to the i18n layer and is explicitly **out of scope here**. What
C5 delivers is the deferred re-render with a loading state, which is the user-visible half.
If the bundle-splitting half is wanted, it needs its own spec — flag it, don't smuggle it in.

**Done when**

- Switching `en → tr → fa` shows the brand loader, then the fully translated page.
- Switching theme does **not** show the loader and does not flash.
- The overlay always clears, including when `/api/preferences` fails or is offline.
- No double-submit is possible while a switch is in flight.
- `next build` reports no new client-boundary errors from the shared hook.

---

## C6 — Loading component becomes the Rellooma logo with a fade animation

**Intent:** one branded loading state everywhere, replacing eight ad-hoc text blocks.

**Current** — 8 route files, 7 of which are near-identical copies of:

```tsx
<main className="content" aria-busy="true">
  <section className="panel">
    <div className="empty-guidance">
      <strong>{t("common.loading")}</strong>
      <span>{t("nav.inbox")}</span>
    </div>
  </section>
</main>
```

and `app/settings/billing/loading.tsx`, which differs — it uses `EmptyState` with
**hardcoded English** ("Loading billing…"). That is an existing i18n bug; C6 fixes it by
deletion.

**New component** — `src/components/ui/brand-loader.tsx`

```tsx
// Server Component. No "use client" — it must be renderable from every loading.tsx.
export function BrandLoader({ variant = "page" }: { variant?: "page" | "overlay" }) {
  return (
    <div
      className={variant === "overlay" ? "brand-loader overlay" : "brand-loader"}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <img
        className="brand-loader-mark"
        src="/brand/rellooma-app-icon.png"
        alt=""
        aria-hidden="true"
      />
      <span className="sr-only">{/* localized "Loading…" */}</span>
    </div>
  );
}
```

Requirements:

- MUST be a Server Component (no `"use client"`) so the 8 `loading.tsx` files can render it
  directly. C5's overlay is rendered _from_ a client component, which is fine — a Server
  Component may be composed into a client tree only as a child; since `BrandLoader` takes no
  server-only data, the simplest correct answer is to keep it dependency-free and let it be
  usable from both. If that proves awkward, split into `brand-loader.tsx` (markup, no
  directive) and let the client overlay import the same file.
- The localized label MUST come from `t("common.loading")` — via `getRequestPreferences()`
  in the route files, or as a `label` prop. **Never hardcode English.** (See the billing bug above.)
- The logo MUST be `alt=""` + `aria-hidden` with the real accessible name in the
  `.sr-only` span. A logo is not a status message.
- MUST NOT use `next/image` with `priority` here — the loader is transient; a plain `<img>`
  with explicit `width`/`height` avoids layout shift and the image-optimizer round-trip.
  Set `width={72} height={74}` (the app icon's 426×437 aspect at 72px wide).
- The animation MUST be pure CSS. No JS timers, no state.

**CSS** — add near the existing `@media (prefers-reduced-motion: no-preference)` block (L2635):

```css
.brand-loader {
  min-height: 60vh;
  display: grid;
  place-items: center;
  gap: 14px;
}

.brand-loader.overlay {
  position: fixed;
  inset: 0;
  z-index: 60; /* above .topbar's z-index: 10 */
  min-height: 0;
  background: color-mix(in srgb, var(--canvas) 86%, transparent);
  backdrop-filter: blur(6px) saturate(120%);
}

.brand-loader-mark {
  width: 72px;
  height: auto;
  opacity: 1;
}

@media (prefers-reduced-motion: no-preference) {
  @keyframes rellooma-breathe {
    0%,
    100% {
      opacity: 0.28;
      transform: scale(0.985);
    }
    50% {
      opacity: 1;
      transform: scale(1);
    }
  }
  .brand-loader-mark {
    animation: rellooma-breathe 1500ms ease-in-out infinite;
  }
}
```

- **Reduced motion is not optional.** The global reduce block clamps
  `animation-duration: .001ms !important` and `animation-iteration-count: 1 !important`.
  Because the animation is declared **inside** `prefers-reduced-motion: no-preference`, it
  never applies under reduce — and `.brand-loader-mark` keeps `opacity: 1`. Do **not** move
  the animation outside that media query; with the global clamp and a `0%` keyframe at
  `opacity: .28`, an unguarded declaration can settle the logo at 28% opacity permanently.
  Verify this case explicitly.
- The existing `rellooma-enter` keyframe (L2636) is a one-shot entrance and is unrelated.
  Name the new one `rellooma-breathe`; do not overload the existing name.
- Overlay z-index must clear `.topbar` (`z-index: 10`) and any modal layer —
  `grep -n "z-index" app/globals.css` and pick a value above the highest, documenting it.

**Route file rewrite** — all 8 become:

```tsx
import { getRequestPreferences } from "@/src/lib/i18n/server";
import { BrandLoader } from "@/src/components/ui/brand-loader";

export default async function Loading() {
  const { t } = await getRequestPreferences();
  return <BrandLoader label={t("common.loading")} />;
}
```

The per-route sub-label (`t("nav.inbox")`, `t("nav.crm")`, …) is dropped — that is the
"less text" principle applied to loading states, and the route is already visible in the
rail behind the loader. If a route name is wanted, it belongs in the `.sr-only` string,
not on screen.

MAY additionally add `app/loading.tsx` at the root so unhandled segments get the same
treatment. Do this only if it does not introduce a loader flash on the auth pages —
verify `/login`, `/signup`, `/onboarding` before keeping it.

**Done when**

- All 8 routes show the fading Rellooma mark and nothing else.
- Under `prefers-reduced-motion: reduce` the mark is **static and fully opaque** — verify in
  DevTools (Rendering → Emulate CSS `prefers-reduced-motion: reduce`).
- A screen reader announces the localized "Loading…" once, in the active locale.
- No hardcoded English remains in any loading file.
- The overlay covers the top bar and rail completely, in both themes.

---

## 3. Summary of file operations

| Operation | Path                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------- |
| Modify    | `src/modules/workspaces/ui/workspace-shell.tsx`                                                                        |
| Modify    | `src/modules/workspaces/ui/preference-controls.tsx` (delegate to shared hook)                                          |
| Modify    | `src/modules/auth/ui/auth-shell.tsx` (swap to `PreferenceButtons`)                                                     |
| Modify    | `app/globals.css`                                                                                                      |
| Modify    | `src/lib/i18n/dictionaries.ts` (3 locale maps, keys removed)                                                           |
| Modify ×8 | `app/{dashboard,inbox,crm,automations,analytics,connections,settings}/loading.tsx`, `app/settings/billing/loading.tsx` |
| Add       | `src/modules/workspaces/ui/nav-icons.tsx`                                                                              |
| Add       | `src/modules/workspaces/ui/preference-buttons.tsx`                                                                     |
| Add       | `src/modules/workspaces/ui/use-preferences.ts`                                                                         |
| Add       | `src/components/ui/brand-loader.tsx`                                                                                   |
| Unchanged | `src/modules/business-profile/ui/settings-panel.tsx`, all integrations/billing/env runtime code                        |

### i18n keys removed (all three locale maps)

`shell.workspace`, `shell.privateTenant`, `shell.workspaceData`, `shell.safeMode`,
`shell.noSend`, and `app.control` — **each one only after** `grep -rn "<key>" app src`
returns no remaining consumer. `shell.search`, `shell.notifications`, `shell.help`,
`shell.pause` and all `nav.*` keys are retained.

---

## 4. Cross-cutting acceptance criteria

**Accessibility**

- Every interactive control has a visible `:focus-visible` indicator against `--canvas`
  and `--surface`, in both themes.
- Icon-only controls have an `aria-label` naming the action **and** the current state.
- Icons are `aria-hidden="true" focusable="false"`.
- Touch targets ≥44×44 CSS px under `@media (pointer: coarse)` (design system rule).
- Loading states expose `role="status"` + `aria-live="polite"`; they do **not** use
  `aria-live="assertive"`.
- Text contrast ≥4.5:1, non-text/UI boundaries ≥3:1, verified in light and dark.
- `@media (prefers-contrast: more)` (L3077) and `@media (forced-colors: active)` (L3093)
  blocks exist — check the new `.icon-button` and `.brand-loader` render acceptably there.
  Forced-colors will drop `background`/`box-shadow`; the icon buttons must still read as buttons.

**RTL** — verify the whole shell at `fa`: rail on the inline-start, controls cluster on the
inline-end, icons not mirrored except directional ones, no horizontal scrollbar.

**Themes** — light and dark, each at 1440px, 1024px, 820px and 390px.

**Verification commands**

```
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Then `pnpm dev` and walk `/dashboard`, `/inbox`, `/crm`, `/automations`, `/analytics`,
`/connections`, `/settings`, `/settings/billing` in `en`, `tr`, `fa` × light, dark.
`pnpm test:e2e` if any Playwright spec asserts on shell text — check first:
`grep -rn "Sandbox\|Workspace operations\|Private tenant" tests/`. Specs asserting on the
removed strings MUST be updated in the same commit, not left failing.

---

## 5. Suggested commit sequence

Small, independently revertible commits, in this order:

1. `C4` — drop the eyebrow above the page title. (Smallest, zero risk, proves the loop.)
2. `C3` — remove Sandbox chrome + dead i18n keys.
3. `C1` — rail simplification + nav icons + responsive selector fixes.
4. `C6` — `BrandLoader` + the 8 loading files. (Independent of C1–C4.)
5. `C2` — shared `use-preferences` hook + icon buttons; restore controls at ≤1050px.
6. `C5` — transition + overlay on locale change. (Depends on C2 and C6.)

C6 before C5 is deliberate: C5 renders the component C6 creates.

---

## 6. Explicit non-goals

- No change to routing, data fetching, auth, or any server action.
- No change to what the app is permitted to send. Sandbox **behaviour** is untouched (C3).
- No new dependency. No Tailwind, no icon package, no animation library.
- No redesign of page bodies — dashboard, inbox, CRM and settings content is out of scope.
- No per-locale bundle splitting (see the note in C5).
- No change to the `active` prop contract of `WorkspaceShell`.

---

## 7. Prerequisites and risks

**P1 — BLOCKING for C6, and possibly already broken in production.**
`src/modules/workspaces/ui/brand-lockup.tsx` requests `/brand/rellooma-horizontal.png` and
`/brand/rellooma-app-icon.png`, and `app/layout.tsx` points its favicon at the latter — but
**there is no `public/` directory in this repository**, and `git ls-files` returns no
`public/` or brand assets. Verified 2026-09-01:

```
$ ls public          → No such file or directory
$ git ls-files | grep -i "brand\|public/"  → only brand-lockup.tsx
```

Before implementing C6, resolve one of:
(a) the assets exist but are gitignored/injected at deploy — confirm and document where;
(b) the assets are missing — add `public/brand/rellooma-app-icon.png` (and the horizontal
lockup) to the repo;
(c) neither is possible — then `BrandLoader` MUST use an inline SVG wordmark instead of an
`<img>`, which is arguably the better answer anyway (no network request in a loading state,
themeable via `currentColor`).

A loading screen whose only content is a 404'd image is worse than the text it replaces.
**Do not ship C6 without confirming the mark actually renders.**

**R1** — `.topbar button` paints all top-bar buttons solid blue; the new icon buttons must
escape it (C2). Most likely visual regression.
**R2** — stale `.workspace-card` / `.safety-lock` selectors left in the two rail media
queries will silently break the collapsed rail (C1).
**R3** — a reduced-motion misconfiguration can freeze the loader at 28% opacity (C6).
**R4** — removing an i18n key that another module still reads will throw or render the raw
key. Always `grep` before deleting.
**R5** — Playwright specs may assert on removed shell strings; check `tests/` before merging.

---

## 8. Decisions the author should confirm

- **D1 — Sandbox scope.** This spec removes Sandbox from the _shell chrome only_ and leaves
  onboarding, connections, test-center and analytics copy intact (§C3). If "delete sandbox"
  meant removing the sandbox **feature** — the connect-sandbox flow, the sandbox adapter, the
  send gate — that is a product change touching `src/modules/integrations/`,
  `src/modules/billing/live-billing-gate.ts` and `src/lib/env.ts`, and it needs its own spec
  and its own risk review. Confirm before anything outside the shell is touched.
- **D2 — Notifications link.** Turn the "Notifications" text link into a bell icon (spec's
  default), or keep the word?
- **D3 — Language control.** Native `<select>` chip (spec's default) or a custom popover menu?
- **D4 — Workspace name in the rail.** Keep the name (spec's default), or drop it too and rely
  on the logo alone?
- **D5 — Root `app/loading.tsx`.** Add it, or keep loading states per-route only?
