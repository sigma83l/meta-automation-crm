/**
 * The console rail's icons.
 *
 * The rail used to prefix each destination with a two-letter code — `PL`, `WS`,
 * `US`, `FF`, `SY`, `AU`, `ST` — in a bordered box. Those are not
 * abbreviations anybody knows: `FF` for Features and `SY` for System have to be
 * learned from the word next to them, which means they carry no information the
 * label does not already carry, and under RTL they sit on the wrong side of it
 * reading as debris. A shape is recognisable before it is read, which is the
 * whole job of an icon in a rail somebody uses every day.
 *
 * Drawn inline rather than imported: seven glyphs are cheaper as markup than as
 * a dependency, they inherit `currentColor` so the active and hover states come
 * free in both themes, and `forced-colors` keeps them because a stroke is a
 * stroke. No icon package, no emoji, no network request.
 *
 * Every one is `aria-hidden` — the visible text label is the accessible name,
 * so announcing the glyph too would say everything twice.
 */

type IconProps = Readonly<{ className?: string }>;

const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false
} as const;

/** Overview: the four panes of a summary screen. */
export function PlatformIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
    </svg>
  );
}

/** Workspaces: separate tenants, stacked and distinct. */
export function WorkspacesIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 2.9 21 7.4l-9 4.5-9-4.5 9-4.5Z" />
      <path d="M3.4 12.3 12 16.6l8.6-4.3" />
      <path d="M3.4 16.9 12 21.2l8.6-4.3" />
    </svg>
  );
}

/** People: two figures, because this directory spans accounts, not one profile. */
export function PeopleIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="9.2" cy="8.4" r="3.4" />
      <path d="M2.9 20.4a6.6 6.6 0 0 1 12.6 0" />
      <path d="M16.4 5.5a3.4 3.4 0 0 1 0 6.5" />
      <path d="M18 14.6a6.6 6.6 0 0 1 3.2 4.4" />
    </svg>
  );
}

/** Features: a flag, which is what the catalogue calls them. */
export function FeaturesIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5.5 21V3.6" />
      <path d="M5.5 4.2h11.8l-2.4 4.3 2.4 4.3H5.5" />
    </svg>
  );
}

/** System: the queues and switches behind the product, as a pulse. */
export function SystemIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M2.8 12.4h4l2-4.6 3.4 8.8 2.2-4.2h6.8" />
    </svg>
  );
}

/** Audit: an append-only list of lines. */
export function AuditIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 5.6h11" />
      <path d="M4 10.6h16" />
      <path d="M4 15.6h11" />
      <path d="M4 20.2h16" />
    </svg>
  );
}

/** Staff access: a key, since this section is who holds one. */
export function StaffIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="8.2" cy="15.8" r="3.6" />
      <path d="M10.9 13.2 19.4 4.7" />
      <path d="M16.4 4.7h3v3" />
    </svg>
  );
}
