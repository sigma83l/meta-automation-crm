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
  // is left". At 443px the cards stack, so the surviving button sits low in the
  // viewport and Playwright scrolls before clicking; an unscoped locator
  // resolves once and then clicks a coordinate the re-render has moved, which
  // is reported as a pointer interception rather than as a stale locator.
  const instagram = page.locator("article.connection-card", {
    has: page.getByText("instagram", { exact: true })
  });
  await instagram.getByRole("button", { name: "Connect sandbox" }).click();
  await expect(instagram.getByRole("heading", { name: "Instagram Sandbox" })).toBeVisible();
  await page.getByRole("button", { name: "Check health" }).first().click();
  await expect(page.getByText(/sandbox · active · healthy/).first()).toBeVisible();
});
