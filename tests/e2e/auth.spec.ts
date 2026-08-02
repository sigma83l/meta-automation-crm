import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("auth surfaces render safe validation and recovery states", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Create your workspace" })).toBeVisible();
  await page.getByLabel("Business name").fill("E2E Business");
  await page.getByLabel("Email").fill("invalid");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create private workspace" }).click();
  await expect(page).toHaveURL(/signup/);

  await page.goto("/forgot-password");
  await expect(page.getByText("same whether or not an account exists")).toBeVisible();
  await page.goto("/reset-password");
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
});

test("protected dashboard redirects an anonymous visitor", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
});

test("signup provisions one workspace and reaches the protected dashboard", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Business name").fill("Playwright Synthetic Studio");
  await page.getByLabel("Email").fill(`playwright-${randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("Correct-Horse-42!");
  await page.getByRole("button", { name: "Create private workspace" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole("button", { name: "Save and exit" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Live sends are locked")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
