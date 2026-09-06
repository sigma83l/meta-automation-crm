import { expect, test } from "@playwright/test";

import { createCustomer, signUp } from "./support/workspace";

/**
 * The pack's ten critical CRM flows, driven through the browser.
 *
 * `tests/golden/04_E2E_CRITICAL_FLOWS` in the pack lists ten journeys. Six of
 * them run here end to end. Two run as far as the product goes and stop where
 * it stops, and the stopping point is asserted rather than glossed: accepting a
 * suggestion settles the suggestion and performs nothing, because the CRM
 * proposes and the domain that owns the send executes.
 *
 * Two are not here at all, and saying which is the point of writing this down:
 *
 *   - Flow 4, a human correcting an AI fact, needs a way to edit a remembered
 *     fact. `contact_facts` has a writer in the engine and no surface in the
 *     product, so there is nothing for a person to click.
 *   - Flow 5, a manual follow-up through the due queue to an outcome, needs the
 *     same. `scheduleFollowUp` and `settleFollowUp` exist, are tested, and no
 *     route calls either.
 *
 * Both are absent surfaces rather than broken ones. Driving them by calling the
 * repository from a test would produce a green flow for a journey no operator
 * can take, which is worse than a gap somebody can read.
 */

// Chromium carries the CRM matrix in full, which is what the pack asks for.
// The mobile project would run these a second time under a viewport it sets
// itself, which contradicts the two flows that set their own.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Chromium carries the CRM flows in full.");
});

test("flow 1: search, open the record, and read the Now state", async ({ page }) => {
  const { db, workspaceId } = await signUp(page, "search");
  await createCustomer(page, db, workspaceId, "Ada Findable");
  await createCustomer(page, db, workspaceId, "Zoe Elsewhere");

  await page.getByRole("textbox", { name: "Search customers" }).fill("Findable");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("link", { name: "Ada Findable" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Zoe Elsewhere" })).toHaveCount(0);

  await page.getByRole("link", { name: "Ada Findable" }).click();
  const now = page.getByRole("region", { name: "Now" });
  await expect(now).toBeVisible();
  // A contact nothing is known about says so in every field, rather than
  // rendering blanks that read as nothing to know.
  await expect(now).toContainText("Current need");
  await expect(now).toContainText("Unknown");
  await expect(now).toContainText("Qualification score");
});

test("flow 2: create and edit a customer, and see it on the timeline", async ({ page }) => {
  const { db, workspaceId } = await signUp(page, "edit");
  const customerId = await createCustomer(page, db, workspaceId, "Bo Editable");

  await page.goto(`/crm/${customerId}`);
  await page.getByRole("textbox", { name: "Edit display name" }).fill("Bo Renamed");
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(page.getByRole("heading", { name: "Bo Renamed" })).toBeVisible();

  // The edit is on the record, not merely in the form that made it.
  const { data: audit } = await db
    .from("crm_audit_events")
    .select("action")
    .eq("workspace_id", workspaceId)
    .eq("customer_id", customerId);
  expect((audit ?? []).map((row) => row.action)).toContain("crm.customer.updated");
});

test("flow 3: an AI memory proposal is classified, and a person settles it", async ({ page }) => {
  const { db, workspaceId, userId } = await signUp(page, "proposal");
  const customerId = await createCustomer(page, db, workspaceId, "Cem Proposed");

  // Seeded through service role because the producer of these is Pack 03's
  // structured extraction call: `applyAiProposal` is the seam it lands on, and
  // until it exists there is no way for a model to put one here. What is under
  // test is the half that is built - that a suggestion reaches a person and
  // that answering it settles the row.
  const { error } = await db.from("crm_next_action_projection").insert({
    workspace_id: workspaceId,
    customer_id: customerId,
    action_type: "reply",
    // Paired by a check constraint: a human owner names a person, and only a
    // human owner may. An operator queue that fills with work nobody assigned
    // themselves is what that rule exists to prevent.
    owner_type: "human",
    owner_id: userId,
    eligibility: "eligible",
    source: "ai",
    confidence: 0.8,
    reason_codes: ["unanswered_inbound"],
    proposed_at: new Date().toISOString()
  });
  expect(error).toBeNull();

  await page.goto(`/crm/${customerId}`);
  const suggestions = page.getByRole("region", { name: "Suggestions" });
  await expect(suggestions).toBeVisible();
  await suggestions.getByRole("button", { name: "Take this on" }).click();

  await expect
    .poll(async () => {
      const { data } = await db
        .from("crm_next_action_projection")
        .select("settled_outcome")
        .eq("customer_id", customerId)
        .single();
      return data?.settled_outcome;
    })
    .toBe("accepted");

  // Accepting performs nothing: the CRM proposes, and the domain that owns the
  // send executes. A test that expected a message here would be asserting a
  // behaviour the design deliberately does not have.
  const { count } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  expect(count ?? 0).toBe(0);
});

test("flow 6: a rejected suggestion is kept, not deleted", async ({ page }) => {
  const { db, workspaceId, userId } = await signUp(page, "reject");
  const customerId = await createCustomer(page, db, workspaceId, "Dila Declined");
  await db.from("crm_next_action_projection").insert({
    workspace_id: workspaceId,
    customer_id: customerId,
    action_type: "task",
    owner_type: "human",
    owner_id: userId,
    eligibility: "eligible",
    source: "ai",
    confidence: 0.6,
    reason_codes: ["follow_up_due"],
    proposed_at: new Date().toISOString()
  });

  await page.goto(`/crm/${customerId}`);
  await page
    .getByRole("region", { name: "Suggestions" })
    .getByRole("button", { name: "Not this" })
    .click();

  // A pattern of bad suggestions is only visible if the bad ones survive.
  await expect
    .poll(async () => {
      const { data } = await db
        .from("crm_next_action_projection")
        .select("settled_outcome")
        .eq("customer_id", customerId)
        .single();
      return data?.settled_outcome;
    })
    .toBe("rejected");
});

test("flow 7: a viewer reads the record and cannot mutate it", async ({ page }) => {
  const { db, workspaceId, userId } = await signUp(page, "viewer");
  const customerId = await createCustomer(page, db, workspaceId, "Eda Readonly");

  // The same session, demoted, rather than a second sign-in. Role is resolved
  // from the membership on every request, so this is exactly what a viewer's
  // session is - and it keeps the test about authority instead of about a
  // second login working.
  await db
    .from("workspace_memberships")
    .update({ role: "viewer" })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);

  await page.goto(`/crm/${customerId}`);
  await expect(page.getByRole("region", { name: "Now" })).toBeVisible();

  // The server is the assertion, not the absence of a button. A viewer who
  // forges the request by hand has to be refused by the route.
  const status = await page.evaluate(async (id) => {
    const token = (
      (await fetch("/api/auth/csrf").then((response) => response.json())) as { token: string }
    ).token;
    const response = await fetch(`/api/crm/customers/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-csrf-token": token },
      body: JSON.stringify({ displayName: "Forged By Viewer" })
    });
    return response.status;
  }, customerId);
  expect(status).toBeGreaterThanOrEqual(400);

  const { data: after } = await db
    .from("customers")
    .select("display_name")
    .eq("id", customerId)
    .single();
  expect(after?.display_name).toBe("Eda Readonly");
});

test("flow 8: the record reads in all three languages, and RTL in Persian", async ({ page }) => {
  const { db, workspaceId } = await signUp(page, "i18n");
  const customerId = await createCustomer(page, db, workspaceId, "Fara Multilingual");

  await page.goto(`/crm/${customerId}`);
  await expect(page.getByRole("region", { name: "Now" })).toBeVisible();

  // Located by position rather than by name: the control's own label is
  // translated, so `getByLabel("Language")` stops matching the instant the
  // switch works - a selector that only finds the thing while it is untested.
  const language = page.locator(".preference-controls select").first();
  await language.selectOption("tr");
  await expect(page.getByRole("region", { name: "Şu an" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");

  await language.selectOption("fa");
  await expect(page.getByRole("region", { name: "اکنون" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("flow 9: the index and the record work at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { db, workspaceId } = await signUp(page, "mobile");
  const customerId = await createCustomer(page, db, workspaceId, "Gizem Mobile");

  for (const path of ["/crm", `/crm/${customerId}`]) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    // A horizontal scrollbar on a phone is the failure this whole viewport
    // exists to catch: the operator queue becomes unreadable rather than
    // merely tight.
    expect(overflow).toBeLessThanOrEqual(1);
  }
  await expect(page.getByRole("region", { name: "Now" })).toBeVisible();
});

test("flow 10: an export is requested and resolves to a state the page can show", async ({
  page
}) => {
  const { db, workspaceId } = await signUp(page, "export");
  await createCustomer(page, db, workspaceId, "Hale Exportable");

  await page.goto("/crm");
  await page.getByRole("button", { name: "Export all" }).click();

  // Pending, ready or refused - all three are answers. What must not happen is
  // a request that resolves to nothing and leaves the operator waiting on a
  // page that will never change.
  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("export_jobs")
          .select("status")
          .eq("workspace_id", workspaceId)
          .limit(1);
        return data?.[0]?.status ?? null;
      },
      { timeout: 20_000 }
    )
    .not.toBeNull();
});
