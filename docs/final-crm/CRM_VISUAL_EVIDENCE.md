# CRM visual evidence

Recorded 2026-09-03 at `691f10a`.

## Coverage

`tests/e2e/crm-visual-matrix.spec.ts` renders three surfaces across three
locales, two themes and three viewports — 54 cells — plus two additional states.

| Axis     | Values                                                                   |
| -------- | ------------------------------------------------------------------------ |
| Surface  | CRM index; a record with a score and a suggestion; a record with neither |
| Locale   | `en`, `tr`, `fa` (RTL)                                                   |
| Theme    | light, dark                                                              |
| Viewport | 1440 (desktop), 1024×768 (the pack's dense check), 390 (phone)           |

Two more states outside the grid: the empty index a workspace meets on its first
day, and a record read by a viewer. Plus the not-found state for an id this
workspace cannot read.

Screenshots are written to Playwright's output directory as
`<surface>-<locale>-<theme>-<width>.png`. Regenerate with:

```
pnpm test:e2e tests/e2e/crm-visual-matrix.spec.ts --project=chromium
```

## What the machine checked in every cell

- Horizontal overflow of the document (must be ≤ 1px).
- `documentElement.lang` matches the requested locale.
- `dir` is `rtl` for `fa` and `ltr` otherwise.
- The resolved theme matches the requested one.
- Exactly one `h1`.
- No control without an accessible name from a label, `aria-label`, text content
  or `title`.
- No `img` without `alt`.

All findings are collected across the whole grid before the assertion fires, so
a reviewer gets the complete list rather than the first cell that failed.

Deliberately **not** a pixel baseline. Fifty-four screenshots across three
writing systems fail on font rendering differences, and a baseline that fails
for that reason teaches people to re-record it — which removes the only signal
it had.

## The hostile data

The grid is populated with values chosen to break layout rather than to look
good: a 71-character Latin name with a hyphen, a 66-character Persian company
name, a contact scoring 92 and one with no score at all, a follow-up three days
overdue, and a live AI suggestion.

## Result at this SHA

All 54 cells pass every machine check. One defect was found and fixed while
producing them: the new-customer form on the index named three inputs by
placeholder alone, which is the last fallback an accessible name has and
disappears the moment somebody types.

## What this does not establish

The pack requires **human screenshot review**, and this is not it. What is
guaranteed here is that a reviewer is looking at a complete, current set with
the machine-decidable failures already ruled out. Judgements a machine cannot
make — whether a Turkish status pill reads as a pill, whether the dark palette
holds contrast on the priority chips, whether the record's density is right at
1024 — remain open and are the reason `CRM_VISUAL_QA` is not marked pass in
`CRM_FREEZE.md`.
