import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test.setTimeout(90_000);

test("owner completes onboarding, creates every recipe, tests, activates and uses mobile navigation", async ({
  page
}) => {
  const email = `owner-${randomUUID()}@example.test`;
  await page.goto("/signup");
  await page.getByLabel("Business name").fill("Owner Panel Synthetic");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Correct-Horse-42!");
  await page.getByRole("button", { name: "Create private workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Set up safely. Go live only when ready." })
  ).toBeVisible();
  await page.getByRole("button", { name: "Save and exit" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.goto("/automations");
  const recipes = [
    "Instagram Comment → DM lead collection",
    "Instagram inbound DM qualification",
    "WhatsApp inbound lead collection",
    "WhatsApp consented reminder",
    "After-hours human handoff"
  ];
  for (let index = 0; index < recipes.length; index++) {
    await page.getByLabel("Automation name").fill(`Synthetic recipe ${index + 1}`);
    await page.getByRole("button", { name: "Continue" }).click();
    await page
      .getByRole("button", {
        name: new RegExp(recipes[index]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      })
      .click();
    for (let step = 0; step < 5; step++) {
      await page.getByRole("button", { name: "Continue" }).click();
    }
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(
      page.getByRole("link", { name: new RegExp(`Synthetic recipe ${index + 1}`) })
    ).toBeVisible();
  }
  await page.getByRole("link", { name: /Synthetic recipe 1/ }).click();
  await page.getByRole("button", { name: "Run safe test" }).click();
  await expect(page.getByRole("status")).toContainText("Safe test completed");
  await page.getByRole("button", { name: "Activate" }).click();
  await expect(page.getByText("Current status: ACTIVE")).toBeVisible();

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const users = await admin.auth.admin.listUsers();
  const user = users.data.users.find((candidate) => candidate.email === email);
  expect(user).toBeTruthy();
  const profile = await admin.from("profiles").select("workspace_id").eq("id", user!.id).single();
  expect(profile.error).toBeNull();
  if (!profile.data) throw new Error("Synthetic workspace profile was not provisioned.");
  const hostileDisplayName = "<img src=x onerror=window.__xss=1> Synthetic";
  const customer = await admin
    .from("customers")
    .insert({
      workspace_id: profile.data.workspace_id,
      display_name: hostileDisplayName,
      source: "e2e",
      created_by: user!.id
    })
    .select("id")
    .single();
  expect(customer.error).toBeNull();
  if (!customer.data) throw new Error("Synthetic inbox customer was not created.");
  const conversation = await admin
    .from("conversations")
    .insert({
      workspace_id: profile.data.workspace_id,
      customer_id: customer.data.id,
      channel: "instagram"
    })
    .select("id")
    .single();
  expect(conversation.error).toBeNull();
  if (!conversation.data) throw new Error("Synthetic inbox conversation was not created.");
  await page.goto(`/inbox?conversation=${conversation.data.id}`);
  await page.getByRole("button", { name: "Take over conversation" }).click();
  await expect(page.getByRole("button", { name: "Resume automation" })).toBeVisible();
  await page.getByRole("button", { name: "Resume automation" }).click();
  await expect(page.getByRole("button", { name: "Take over conversation" })).toBeVisible();
  await page.goto("/crm");
  await expect(page.getByText(hostileDisplayName)).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as typeof window & { __xss?: number }).__xss)).toBe(
    undefined
  );

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(mobile).toBeVisible();
  await expect(mobile.getByRole("link", { name: "Create" })).toBeVisible();
  await mobile.getByRole("link", { name: "CRM" }).click();
  await expect(page.getByRole("heading", { name: "CRM" })).toBeVisible();
});
