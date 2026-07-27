import { expect, test } from "@playwright/test";

test("renders the workspace-safe foundation", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Every conversation stays inside its workspace." })
  ).toBeVisible();
  await expect(page.getByText("Live sends are locked")).toBeVisible();
  await expect(page.getByText("Synthetic only")).toBeVisible();
});

test("health endpoint is non-secret and ready", async ({ request }) => {
  const response = await request.get("/api/health");
  const body = (await response.json()) as Record<string, unknown>;

  expect(response.ok()).toBe(true);
  expect(body.status).toBe("ok");
  expect(body.service).toBe("meta-automation-crm");
  expect(JSON.stringify(body)).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
});
