import { describe, expect, it } from "vitest";

import {
  AUTOMATION_TABS,
  DEFAULT_AUTOMATION_TAB,
  resolveTab
} from "@/src/modules/automations/detail-tabs";

describe("automation detail tabs", () => {
  it("accepts every tab it offers", () => {
    for (const tab of AUTOMATION_TABS) {
      expect(resolveTab(tab.id)).toBe(tab.id);
    }
  });

  it("falls back to overview rather than failing on junk", () => {
    // A stale bookmark or a hand-edited URL should land somewhere useful: the
    // tab is a view of one record, not part of its identity.
    expect(resolveTab(undefined)).toBe(DEFAULT_AUTOMATION_TAB);
    expect(resolveTab("")).toBe(DEFAULT_AUTOMATION_TAB);
    expect(resolveTab("Runs")).toBe(DEFAULT_AUTOMATION_TAB);
    expect(resolveTab("../../etc/passwd")).toBe(DEFAULT_AUTOMATION_TAB);
    expect(resolveTab("__proto__")).toBe(DEFAULT_AUTOMATION_TAB);
  });

  it("takes the first value when the query repeats the parameter", () => {
    // `?tab=runs&tab=settings` arrives as an array, which would otherwise be
    // compared against the tab ids as a whole and always miss.
    expect(resolveTab(["runs", "settings"])).toBe("runs");
    expect(resolveTab([])).toBe(DEFAULT_AUTOMATION_TAB);
    expect(resolveTab(["nonsense"])).toBe(DEFAULT_AUTOMATION_TAB);
  });

  it("still lists the five tabs the route contract names", () => {
    expect(AUTOMATION_TABS.map((tab) => tab.id)).toEqual([
      "overview",
      "runs",
      "versions",
      "analytics",
      "settings"
    ]);
  });
});
