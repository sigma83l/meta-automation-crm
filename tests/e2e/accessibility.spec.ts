import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

const ownerRoutes = [
  "/onboarding",
  "/dashboard",
  "/inbox",
  "/automations",
  "/automations/recipes",
  "/automations/test-center",
  "/crm",
  "/analytics",
  "/connections",
  "/settings"
] as const;

test("P0 owner routes have no serious or critical WCAG 2.2 AA violations", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Business name").fill("Accessibility Synthetic Business");
  await page.getByLabel("Email").fill(`a11y-${randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("Correct-Horse-42!");
  await page.getByRole("button", { name: "Create private workspace" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.waitForLoadState("networkidle");

  for (const route of ownerRoutes) {
    await page.goto(route);
    await expect(page.locator('main[aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByRole("main").last()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(async () => {
      const analysis = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const releaseBlocking = analysis.violations
        .filter(({ impact }) => impact === "critical" || impact === "serious")
        .map(({ id, impact, help, nodes }) => ({
          id,
          impact,
          help,
          targets: nodes.map(({ target }) => target)
        }));

      expect(releaseBlocking, `${route} accessibility violations`).toEqual([]);
    }).toPass({ timeout: 10_000 });
  }
});

test("keyboard focus stays visible and unobscured at 200% equivalent reflow", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  const visited: string[] = [];
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        tag: element.tagName,
        text: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "",
        rect: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left },
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth)
      };
    });
    expect(focus).not.toBeNull();
    if (!focus) continue;
    visited.push(`${focus.tag}:${focus.text}`);
    expect(focus.rect.top).toBeGreaterThanOrEqual(0);
    expect(focus.rect.left).toBeGreaterThanOrEqual(0);
    expect(focus.rect.right).toBeLessThanOrEqual(720);
    expect(focus.rect.bottom).toBeLessThanOrEqual(900);
    expect(focus.outlineStyle).not.toBe("none");
    expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);
  }

  expect(visited.some((item) => item.includes("INPUT"))).toBe(true);
  expect(visited.some((item) => item.includes("BUTTON:Sign in"))).toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});

test("critical controls remain perceivable in forced colors", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/login");

  const email = page.getByLabel("Email");
  await email.focus();
  await expect(email).toBeFocused();
  await expect(email).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  const outline = await email.evaluate((input) => getComputedStyle(input).outlineStyle);
  expect(outline).not.toBe("none");
});
