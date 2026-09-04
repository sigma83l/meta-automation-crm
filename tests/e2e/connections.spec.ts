import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
test("connects isolated WhatsApp and Instagram sandbox assets with live warning", async ({
  page
}) => {
  await page.goto("/signup");
  await page.getByLabel("Business name").fill("Meta E2E Synthetic");
  await page.getByLabel("Email").fill(`meta-e2e-${randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("Correct-Horse-42!");
  await page.getByRole("button", { name: "Create private workspace" }).click();
  await page.getByRole("button", { name: "Save and exit" }).click();
  await page.goto("/connections");
  await expect(page.getByText("LIVE_MULTI_BUSINESS_BLOCKED_BY_META")).toBeVisible();
  await expect(page.getByText(/Sandbox is complete and sends nothing/)).toBeVisible();
  // The warning states a policy code with no break opportunity in it, and a
  // word the page cannot break sets a floor under how narrow the page may be.
  // Past the device width Chrome does not overflow, it zooms the whole page out
  // and widens the layout viewport to match - so the usual
  // `scrollWidth <= innerWidth` check stays true while every control on the
  // page is drawn 7% off from where the browser accepts a tap. Asserting the
  // layout viewport is still the device width is what catches that.
  expect(await page.evaluate(() => window.innerWidth)).toBe(page.viewportSize()?.width);
  await page.getByRole("button", { name: "Connect sandbox" }).first().click();
  await expect(page.getByText("WhatsApp Sandbox")).toBeVisible();
  // Connecting refreshes the panel, which replaces both cards. Waiting for the
  // heading alone is not enough: it appears while the refresh is still in
  // flight, and a click issued then lands on a button React is about to
  // replace, so the second connect is silently dropped and Instagram stays
  // "Not connected" with nothing reporting why. The connected card's own
  // actions are the signal that the refresh has settled.
  await expect(page.getByRole("button", { name: "Check health" })).toBeVisible();
  // Scoped to the card it belongs to, rather than "whichever Connect sandbox
  // is left", so the assertion below is about Instagram and not about whichever
  // card happens to be second.
  const instagram = page.locator("article.connection-card", {
    has: page.getByText("instagram", { exact: true })
  });
  await instagram.getByRole("button", { name: "Connect sandbox" }).click();
  await expect(instagram.getByRole("heading", { name: "Instagram Sandbox" })).toBeVisible();
  await page.getByRole("button", { name: "Check health" }).first().click();
  await expect(page.getByText(/sandbox · active · healthy/).first()).toBeVisible();
});
