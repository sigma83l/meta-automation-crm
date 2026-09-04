import { expect, test, type Page } from "@playwright/test";

import { setPreferences, signUp } from "./support/workspace";

/**
 * The platform console, as staff meet it.
 *
 * It had no browser coverage at all, and the gap showed: every table in it was
 * laid out by a class written for different markup, so eight headings rendered
 * as one run-on line and no column sat over its own values. Nothing failed -
 * the console has no unit test that can see a stylesheet, and the CRM visual
 * matrix does not visit `/admin`.
 *
 * So this asserts the one property a table has to have to be a table: each
 * heading is horizontally aligned with the cells beneath it. That is decidable
 * from geometry, holds in both writing directions, and does not pin a pixel.
 */

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Chromium carries the console checks.");
});

/**
 * Grants staff access the way the bootstrap script does.
 *
 * Through service role, because that is the only way a first `platform_owner`
 * can exist: a path inside the application - an env allowlist, an email
 * pattern, first-user-wins - would turn one misconfigured value into a
 * cross-tenant superuser. The null `granted_by` is the same gap the script
 * leaves, and for the same reason: there was no signed-in person to attribute
 * it to.
 */
async function grantStaff(db: Awaited<ReturnType<typeof signUp>>["db"], userId: string) {
  const { error } = await db.from("platform_admins").insert({
    user_id: userId,
    role: "platform_owner",
    status: "active",
    granted_reason: "end-to-end console coverage"
  });
  expect(error).toBeNull();
}

/**
 * Marks setup finished, which the product cannot currently do from the wizard.
 *
 * `/dashboard` redirects to `/onboarding` until `auth_completed_at` is set, and
 * the only thing that sets it is Enter Sandbox on the final stage. Save and exit
 * saves and then navigates to `/dashboard`, which bounces straight back - so
 * there is no way out of setup short of finishing all eight steps. That is a
 * product bug, filed separately; walking eight stages here would be testing the
 * wizard rather than the console.
 */
async function finishSetup(db: Awaited<ReturnType<typeof signUp>>["db"], userId: string) {
  const { error } = await db
    .from("onboarding_states")
    .update({ auth_completed_at: new Date().toISOString() })
    .eq("user_id", userId);
  expect(error).toBeNull();
}

/**
 * Every heading's inline start, and the same edge on the first row's cells.
 *
 * Selects any table on the page rather than one carrying a particular class.
 * Keying on `.admin-table` would let the exact regression this guards against
 * slip through: a table whose class is changed stops matching, the check finds
 * nothing, and a misaligned table reads as a page with no table on it.
 */
async function columnEdges(page: Page) {
  return page.evaluate(() => {
    const table = document.querySelector("main table");
    if (!table) return null;
    const edge = (element: Element) => Math.round(element.getBoundingClientRect().left);
    return {
      headings: [...table.querySelectorAll("thead th")].map(edge),
      cells: [...table.querySelectorAll("tbody tr:first-child > td")].map(edge)
    };
  });
}

test("a customer who guesses the URL sees a missing page, not a locked door", async ({ page }) => {
  await signUp(page, "console-outsider");
  // Asked through the request context, which carries this session's cookies and
  // reports the status plainly. 404 rather than 403: a distinct refusal would
  // confirm the console exists to anyone who tried the address.
  const response = await page.request.get("/admin");
  expect(response.status()).toBe(404);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Platform" })).toHaveCount(0);
});

test("the console's tables put every heading over its own column", async ({ page }) => {
  const { db, userId } = await signUp(page, "console-staff");
  await grantStaff(db, userId);

  for (const path of ["/admin/workspaces", "/admin/users", "/admin/features", "/admin/audit"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const edges = await columnEdges(page);
    // Some of these are empty on a fresh workspace and render a guidance state
    // instead. An absent table is not a misaligned one.
    if (!edges || edges.headings.length === 0 || edges.cells.length === 0) continue;

    expect(edges.cells.length, `${path}: cell count matches heading count`).toBe(
      edges.headings.length
    );
    for (const [index, heading] of edges.headings.entries()) {
      expect(
        Math.abs(heading - edges.cells[index]!),
        `${path}: column ${index} alignment`
      ).toBeLessThanOrEqual(2);
    }

    // And the page itself never scrolls sideways: a wide table scrolls inside
    // its own panel instead.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `${path}: page overflow`).toBeLessThanOrEqual(1);
  }
});

test("the tables hold their columns in Persian, right to left", async ({ page }) => {
  const { db, userId } = await signUp(page, "console-rtl");
  await grantStaff(db, userId);
  await setPreferences(page, "fa", "dark");

  await page.goto("/admin/workspaces");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  const edges = await columnEdges(page);
  expect(edges?.headings.length ?? 0).toBeGreaterThan(0);
  for (const [index, heading] of (edges?.headings ?? []).entries()) {
    expect(Math.abs(heading - edges!.cells[index]!)).toBeLessThanOrEqual(2);
  }
});

test("the staff link appears in the workspace bar, and leads to the console", async ({ page }) => {
  const { db, userId } = await signUp(page, "console-door");
  await grantStaff(db, userId);
  await finishSetup(db, userId);

  await page.goto("/dashboard");
  // Visibility, not authority - every route under /admin resolves staff
  // identity for itself. Without it staff have to remember an unlinked URL.
  const door = page.locator('.topbar a[href="/admin"]');
  await expect(door).toBeVisible();
  await door.click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { level: 1, name: "Platform" })).toBeVisible();
});
