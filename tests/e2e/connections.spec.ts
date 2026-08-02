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
  await page.getByRole("button", { name: "Connect sandbox" }).click();
  await expect(page.getByText("Instagram Sandbox")).toBeVisible();
  await page.getByRole("button", { name: "Check health" }).first().click();
  await expect(page.getByText(/sandbox · active · healthy/).first()).toBeVisible();
});
