import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

/**
 * The signup form's two obligations: say what a password must be, and never
 * put one somewhere it can be read later.
 */
test("signup states the real password rule and never leaks one into the URL", async ({ page }) => {
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

  /**
   * The form carries credentials and submits through an `onSubmit` handler, so
   * before hydration a click used to fall through to a native GET - navigating
   * to /signup?email=...&password=..., which writes the password into browser
   * history, the access log, and any Referer that follows. Asserting on the URL
   * is what catches a regression: the visible behaviour is identical either way.
   */
  expect(page.url()).not.toContain("password");
  expect(page.url()).not.toContain("@");

  await page.getByLabel("Password").fill("Rellooma2026Test");
  await page.getByRole("button", { name: "Create private workspace" }).click();
  await expect(page).toHaveURL(/onboarding|dashboard/);
  expect(page.url()).not.toContain("password");
});
