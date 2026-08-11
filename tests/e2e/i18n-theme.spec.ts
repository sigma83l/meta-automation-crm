import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

test("locale, RTL, theme and resumable onboarding persist without mobile overflow", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/signup");
  await page.getByLabel("Business name").fill("RTL Synthetic Business");
  await page.getByLabel("Email").fill(`rtl-${randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("Correct-Horse-42!");
  await page.getByRole("button", { name: "Create private workspace" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(
    page.getByRole("heading", { name: "Set up safely. Go live only when ready." })
  ).toBeVisible();

  await page.getByLabel("Language").first().selectOption("fa");
  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByLabel("زبان").first()).toBeVisible();
  await page.locator(".preference-controls select").nth(1).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const workspaceName = page.locator('input[name="workspaceName"]');
  await workspaceName.fill("فضای کاری آزمایشی");
  await workspaceName.blur();
  await expect(page.getByRole("status")).toContainText("ذخیره شد");
  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('input[name="workspaceName"]')).toHaveValue("فضای کاری آزمایشی");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.getByLabel("زبان").first().selectOption("tr");
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByLabel("Dil").first().selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotion = await page.evaluate(() => ({
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    animationDuration: getComputedStyle(document.querySelector(".setup-fields")!).animationDuration
  }));
  expect(reducedMotion.scrollBehavior).toBe("auto");
  const animationDurationMs = reducedMotion.animationDuration.endsWith("ms")
    ? Number.parseFloat(reducedMotion.animationDuration)
    : Number.parseFloat(reducedMotion.animationDuration) * 1_000;
  expect(animationDurationMs).toBeLessThanOrEqual(0.001);
});
