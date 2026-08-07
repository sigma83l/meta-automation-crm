import { expect, test } from "@playwright/test";

test("routes anonymous users to the secure entry surface", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  const brand = page.getByRole("link", { name: "Rellooma" });
  await expect(brand).toBeVisible();
  await expect(brand.locator(".brand-logo-horizontal")).toBeVisible();
  await expect(brand.locator(".brand-logo-horizontal")).toHaveAttribute(
    "src",
    /rellooma-horizontal/
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
});

test("health endpoint is non-secret and ready", async ({ request }) => {
  const response = await request.get("/api/health");
  const body = (await response.json()) as Record<string, unknown>;

  expect(response.ok()).toBe(true);
  expect(body.status).toBe("ok");
  expect(body.service).toBe("meta-automation-crm");
  expect(JSON.stringify(body)).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
});
