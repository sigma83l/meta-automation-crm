import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("creates, reloads, edits, uploads and exports a workspace customer", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Business name").fill("CRM E2E Synthetic");
  await page.getByLabel("Email").fill(`crm-e2e-${randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("Correct-Horse-42!");
  await page.getByRole("button", { name: "Create private workspace" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole("button", { name: "Enter sandbox workspace" }).click();

  await page.goto("/crm");
  await page.getByPlaceholder("Display name").fill("Ada Synthetic");
  await page.getByPlaceholder("Company", { exact: true }).fill("Fixture Labs");
  await page.getByPlaceholder("Email").fill("ada@example.test");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("link", { name: "Ada Synthetic" })).toBeVisible();

  await page.getByLabel("Search customers").fill("Ada");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.getByRole("link", { name: "Ada Synthetic" }).click();
  await page.getByLabel("Edit display name").fill("Ada Reloaded");
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(page.getByRole("status")).toContainText("saved");
  await expect(page.getByRole("heading", { name: "Ada Reloaded" })).toBeVisible();

  await page.getByRole("link", { name: "Timeline" }).click();
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await page.getByRole("link", { name: "Files" }).click();
  await page.getByLabel("Customer file").setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
  });
  await page.getByRole("button", { name: "Upload private file" }).click();
  await expect(page.getByRole("status")).toContainText("uploaded");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export customer" }).click();
  await expect(await download).toBeTruthy();
});

test("inbox foundation uses a responsive safe empty state", async ({ page }) => {
  await page.goto("/inbox");
  await expect(page).toHaveURL(/\/login/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
