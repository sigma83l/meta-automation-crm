import { expect, test } from "@playwright/test";

test("critical entry surface keeps its brand, fonts, focus and private indexing", async ({
  page
}) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Build smarter automations. Turn more conversations into qualified leads."
    })
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");

  const fontFamily = await page
    .locator("body")
    .evaluate((body) => getComputedStyle(body).fontFamily);
  expect(fontFamily).toContain("Geist");
  await expect.poll(() => page.evaluate(() => document.fonts.check("16px Geist"))).toBe(true);

  const email = page.getByLabel("Email");
  await email.focus();
  await expect(email).toBeFocused();
  const focus = await email.evaluate((input) => {
    const style = getComputedStyle(input);
    const rect = input.getBoundingClientRect();
    return { outline: style.outlineStyle, width: style.outlineWidth, bottom: rect.bottom };
  });
  expect(focus.outline).not.toBe("none");
  expect(Number.parseFloat(focus.width)).toBeGreaterThanOrEqual(2);
  expect(focus.bottom).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));

  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});
