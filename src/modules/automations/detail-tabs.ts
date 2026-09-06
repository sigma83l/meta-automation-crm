/**
 * The tabs on an automation's detail page.
 *
 * A plain module with no server imports, because both the page and its tests
 * need `resolveTab`, and the page is a server component while the test is not.
 */

export const AUTOMATION_TABS = [
  { id: "overview", label: "Overview" },
  { id: "runs", label: "Runs" },
  { id: "versions", label: "Versions" },
  { id: "analytics", label: "Analytics" },
  { id: "settings", label: "Settings" }
] as const;

export type AutomationTabId = (typeof AUTOMATION_TABS)[number]["id"];

export const DEFAULT_AUTOMATION_TAB: AutomationTabId = "overview";

/**
 * Reads the tab out of a query string.
 *
 * Anything unrecognised falls back to Overview rather than 404ing: a stale or
 * hand-edited link should land the operator somewhere useful, and the tab is a
 * view of one record, not an identity. `searchParams` values arrive as
 * `string | string[] | undefined`, so a repeated `?tab=` is narrowed here
 * rather than at every call site.
 */
export function resolveTab(value: string | readonly string[] | undefined): AutomationTabId {
  const first = Array.isArray(value) ? value[0] : value;
  return AUTOMATION_TABS.some((tab) => tab.id === first)
    ? (first as AutomationTabId)
    : DEFAULT_AUTOMATION_TAB;
}
