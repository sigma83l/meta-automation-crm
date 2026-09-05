import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

/**
 * The lab is a developer tool, so this asserts the two things a developer
 * relies on and nothing about the model's wording: that a run reaches a real
 * provider and reports what each role did, and that pipeline mode reaches a
 * turn outcome rather than stopping at a draft.
 *
 * The generous timeout is deliberate. A real model call over a real network is
 * what is being tested - stubbing the provider here would leave the wiring
 * between the form, the ports and the engine unexercised, which is the only
 * part this file can actually cover.
 */
test("the AI lab answers through the real provider in both modes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "One browser exercises the wiring.");
  test.setTimeout(180_000);

  await page.goto("/signup");
  await page.getByLabel("Business name").fill("AI Lab Synthetic");
  await page.getByLabel("Email").fill(`lab-${randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("Correct-Horse-42!");
  await page.getByRole("button", { name: "Create private workspace" }).click();
  await page.getByRole("button", { name: "Save and exit" }).click();

  // One approved fact, so a reply can cite something and the run is not
  // measuring what the model invents.
  await page.goto("/settings");
  await page.locator('textarea[name="description"]').first().fill("A synthetic bakery");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status")).toContainText("saved");
  await page.getByLabel("Question").fill("What are your opening hours?");
  await page.getByRole("textbox", { name: "Answer", exact: true }).fill("09:00 to 17:00, Mon-Fri");
  await page.getByRole("button", { name: "Add FAQ" }).click();
  await expect(page.getByText("What are your opening hours?")).toBeVisible();

  await page.goto("/dev/ai-lab");
  await expect(page.getByRole("heading", { name: "AI Lab" })).toBeVisible();

  // Wait for hydration before typing. The message box is a controlled input:
  // text filled before React takes over lands in the DOM but never in state, so
  // the run button - which is disabled while the message is empty - stays
  // disabled with a visibly filled box. "Clear" is gated on hydration alone and
  // on nothing else, which makes it the honest signal that React is listening.
  await expect(page.getByRole("button", { name: "Clear" })).toBeEnabled();
  await page.getByLabel("Customer message").fill("When are you open?");
  await page.getByRole("button", { name: "Ask the model" }).click();
  // The primary row is the one that must have succeeded: utility is a cheaper
  // pre-pass and the engine treats its absence as an uncertain understanding,
  // so asserting on it would make this test fail for a latency blip rather
  // than for a broken lab.
  const primaryRow = page.locator(".ai-lab-calls tbody tr", { hasText: "primary" });
  await expect(primaryRow).toBeVisible({ timeout: 120_000 });
  // What this test owns is the wiring: that the form reached the configured
  // model in the primary role and that the lab reported the outcome. Whether
  // Google answers is not ours - a shared key gets rate-limited when the whole
  // suite runs, and failing the build for that would teach everyone to ignore
  // this test. A provider-side refusal is therefore accepted and named; a
  // missing row, an empty model, or a silent absence of any call is not.
  await expect(primaryRow).toContainText(/gemini/);
  const outcome = await primaryRow.innerText();
  expect(outcome).toMatch(/\bok\b|rate_limit|timeout|unavailable/);
  // The reply only exists when the model actually answered.
  if (/\bok\b/.test(outcome)) await expect(page.locator(".ai-lab-reply")).toBeVisible();

  await page.getByRole("button", { name: "Pipeline", exact: true }).click();
  await page.getByLabel("Customer message").fill("When are you open?");
  await page.getByRole("button", { name: "Run a turn" }).click();
  // The verdict pill exists only on a pipeline result, so its appearance is
  // what proves the engine ran - the prompt result is still on screen, and
  // anything it also renders would pass without the pipeline having started.
  await expect(page.locator(".ai-lab-verdict")).toBeVisible({ timeout: 120_000 });
  // The engine reaches an outcome whatever the provider does - that is the
  // property worth proving, and it is exactly what a provider outage must not
  // break: an unreachable model degrades to a handoff rather than an exception.
  await expect(page.locator(".ai-lab-verdict .status-pill")).not.toBeEmpty();
});
