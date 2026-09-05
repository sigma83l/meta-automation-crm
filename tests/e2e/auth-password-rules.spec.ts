import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

/** The signup form's first obligation: say what a password must actually be. */
test("signup states the real password rule", async ({ page }) => {
  await page.goto("/signup");

  await expect(page.locator("form small").first()).toHaveText(
    /uppercase letter.*lowercase letter.*digit/i
  );

  await page.getByLabel("Business name").fill("Password Rules");
  await page.getByLabel("Email").fill(`pw-${randomUUID()}@example.test`);
  // Long enough for the stated length, missing two of the required classes.
  await page.getByLabel("Password").fill("passwordpassword");
  await page.getByRole("button", { name: "Create private workspace" }).click();

  // Names the rule that was missed. "Email or password could not be accepted"
  // was the old answer, and it told the person nothing they could act on.
  await expect(page.locator(".auth-notice")).toContainText(/uppercase/i);

  await page.getByLabel("Password").fill("Rellooma2026Test");
  await page.getByRole("button", { name: "Create private workspace" }).click();
  await expect(page).toHaveURL(/onboarding|dashboard/);
});
