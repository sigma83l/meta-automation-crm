import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
test("configures structured business knowledge and shows the Demo privacy boundary", async ({
  page
}) => {
  await page.goto("/signup");
  await page.getByLabel("Business name").fill("Knowledge E2E Synthetic");
  await page.getByLabel("Email").fill(`knowledge-${randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("Correct-Horse-42!");
  await page.getByRole("button", { name: "Create private workspace" }).click();
  await page.getByRole("button", { name: "Save and exit" }).click();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Business Profile" })).toBeVisible();
  await page.locator('textarea[name="description"]').first().fill("Synthetic business description");
  // A closed list now, not free text: the column had no check and a workspace
  // reached production with `primary_language = "jgwejf"`.
  await page.getByLabel("Primary language").selectOption("tr");
  await page.getByLabel("AI mode").selectOption("FREE_GEMINI_DEMO_SYNTHETIC_ONLY");
  await page.getByLabel("Explicit Demo mode").check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status")).toContainText("saved");
  await expect(page.getByText(/prohibited for webhooks/)).toBeVisible();
  await page.getByLabel("Question").fill("Çalışma saatleri?");
  await page.getByRole("textbox", { name: "Answer", exact: true }).fill("09:00–17:00");
  await page.getByRole("button", { name: "Add FAQ" }).click();
  await expect(page.getByText("Çalışma saatleri?")).toBeVisible();
});
