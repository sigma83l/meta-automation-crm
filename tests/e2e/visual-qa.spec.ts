import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("owner routes fit desktop, tablet, mobile and RTL without horizontal overflow", async ({
  page
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "One browser covers the explicit viewport matrix."
  );

  await page.goto("/signup");
  await page.getByLabel("Business name").fill("Visual QA Synthetic");
  await page.getByLabel("Email").fill(`visual-${randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("Correct-Horse-42!");
  await page.getByRole("button", { name: "Create private workspace" }).click();
  await page.getByRole("button", { name: "Enter sandbox workspace" }).click();
  await expect(page).toHaveURL(/dashboard/);

  for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "tablet", width: 820, height: 1180 },
    { name: "mobile", width: 390, height: 844 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`overview-${viewport.name}.png`),
      fullPage: true,
      caret: "initial"
    });

    await page.goto("/automations");
    await expect(page.getByRole("heading", { name: "Automations", level: 1 })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`automations-${viewport.name}.png`),
      fullPage: true,
      caret: "initial"
    });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();

  await page.goto("/automations");
  await page.addStyleTag({
    content: ".app-shell { direction: rtl; }"
  });
  await expect(page.getByRole("heading", { name: "Automations", level: 1 })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  const accessibilitySmoke = await page.evaluate(() => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    };
    const controls = [...document.querySelectorAll("button,a,input,select,textarea")].filter(
      visible
    );
    const unlabeled = controls.filter((element) => {
      if (element instanceof HTMLInputElement && element.type === "hidden") return false;
      const labelledBy = element.getAttribute("aria-labelledby");
      const explicitLabel =
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
          ? Boolean(element.labels?.length)
          : false;
      return !(
        element.getAttribute("aria-label") ||
        labelledBy ||
        explicitLabel ||
        element.textContent?.trim() ||
        element.getAttribute("title")
      );
    });
    return {
      lang: document.documentElement.lang,
      h1Count: document.querySelectorAll("h1").length,
      unlabeledCount: unlabeled.length,
      imagesWithoutAlt: [...document.querySelectorAll("img")].filter(
        (image) => !image.hasAttribute("alt")
      ).length
    };
  });
  expect(accessibilitySmoke).toEqual({
    lang: "en",
    h1Count: 1,
    unlabeledCount: 0,
    imagesWithoutAlt: 0
  });
  const semanticFocusOrder = await page.evaluate(() => {
    const brand = document.querySelector<HTMLAnchorElement>(".brand-lockup");
    const signOut = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Sign out"
    );
    return {
      brandTabIndex: brand?.tabIndex,
      signOutTabIndex: signOut?.tabIndex,
      brandBeforeSignOut:
        brand && signOut
          ? Boolean(brand.compareDocumentPosition(signOut) & Node.DOCUMENT_POSITION_FOLLOWING)
          : false
    };
  });
  expect(semanticFocusOrder).toEqual({
    brandTabIndex: 0,
    signOutTabIndex: 0,
    brandBeforeSignOut: true
  });
  await page.screenshot({
    path: testInfo.outputPath("automations-mobile-rtl.png"),
    fullPage: true,
    caret: "initial"
  });
});
