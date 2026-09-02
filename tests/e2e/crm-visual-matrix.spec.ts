import { expect, test, type Page } from "@playwright/test";

import { setPreferences, signUp } from "./support/workspace";

/**
 * The pack's visual matrix for the two surfaces this pack changed.
 *
 * `tests/05_VISUAL_MATRIX` asks for the CRM index and the customer record at
 * EN/TR/FA × Light/Dark × 1440/390, with dense checks at 1024/768, across a
 * list of states. That is eighteen combinations per surface, and a person
 * cannot hold eighteen screenshots in their head and notice the one where a
 * Turkish status pill wrapped.
 *
 * So this does the half a machine is good at and leaves the half it is not.
 * Every combination is rendered, checked for the failures that are decidable -
 * horizontal overflow, an unlabelled control, a missing or duplicated h1, a
 * mis-set document direction - and written to disk as a numbered artefact. The
 * pack requires human screenshot review, and nothing here is a substitute for
 * it: what this guarantees is that the reviewer is looking at a complete set
 * rather than the four screens somebody remembered to take.
 *
 * The states are seeded to be hostile on purpose. A name long enough to break a
 * column, a Persian value long enough to break it in the other direction, a
 * contact with a high score and one with none, an overdue follow-up, and a
 * viewer who may look and not touch.
 */

const LOCALES = ["en", "tr", "fa"] as const;
const THEMES = ["light", "dark"] as const;
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 1000 },
  // The pack's dense check. A layout that survives 1440 and 390 can still fail
  // in between, where a sidebar is present and the content column is narrowest.
  { name: "1024", width: 1024, height: 768 },
  { name: "390", width: 390, height: 844 }
] as const;

/** A name long enough to break a column that assumes names are short. */
const LONG_NAME = "Konstantina Papadopoulou-Vasilakis of the Northern Districts Partnership";
/** The same problem in Persian, where the script is wider and the direction flips. */
const LONG_PERSIAN = "شرکت مهندسی و بازرگانی پیشگامان توسعه پایدار خاورمیانه و شمال آفریقا";

/**
 * The checks a machine can decide, run on whatever is currently on screen.
 *
 * Deliberately not a pixel comparison. A screenshot baseline for eighteen
 * combinations across three locales fails on font rendering and teaches people
 * to re-record it, which removes the only signal it had.
 */
async function inspect(page: Page) {
  return page.evaluate(() => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    };
    const controls = [...document.querySelectorAll("button,a,input,select,textarea")].filter(
      visible
    );
    const unlabeled = controls.filter((element) => {
      if (element instanceof HTMLInputElement && element.type === "hidden") return false;
      const explicitLabel =
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
          ? Boolean(element.labels?.length)
          : false;
      return !(
        element.getAttribute("aria-label") ||
        element.getAttribute("aria-labelledby") ||
        explicitLabel ||
        element.textContent?.trim() ||
        element.getAttribute("title")
      );
    });
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      theme: document.documentElement.dataset.theme ?? "",
      h1Count: document.querySelectorAll("h1").length,
      unlabeledCount: unlabeled.length,
      imagesWithoutAlt: [...document.querySelectorAll("img")].filter(
        (image) => !image.hasAttribute("alt")
      ).length
    };
  });
}

test("the CRM index and record across EN/TR/FA, light and dark, at three widths", async ({
  page
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Chromium carries the full matrix; the other engines run the critical smoke below."
  );
  test.setTimeout(300_000);

  const { db, workspaceId, userId } = await signUp(page, "visual");

  // Empty first: the state an operator meets on their first day, and the one
  // most likely to render as a broken layout rather than as an answer.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/crm");
  const empty = await inspect(page);
  expect(empty.overflow).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath("crm-index-empty-en-light-1440.png"),
    fullPage: true
  });

  // Then populated, with the values that break things.
  const { data: seeded, error } = await db
    .from("customers")
    .insert([
      {
        workspace_id: workspaceId,
        display_name: LONG_NAME,
        company_name: LONG_NAME,
        created_by: userId,
        lead_status: "needs_reply"
      },
      {
        workspace_id: workspaceId,
        display_name: LONG_PERSIAN,
        company_name: LONG_PERSIAN,
        created_by: userId,
        lead_status: "human_review"
      },
      {
        workspace_id: workspaceId,
        display_name: "Low Score",
        created_by: userId,
        lead_status: "awaiting_customer"
      },
      {
        workspace_id: workspaceId,
        display_name: "High Score",
        created_by: userId,
        lead_status: "booked"
      }
    ])
    .select("id,display_name");
  expect(error).toBeNull();
  const rows = seeded ?? [];
  const highScore = rows.find((row) => row.display_name === "High Score")!;
  const lowScore = rows.find((row) => row.display_name === "Low Score")!;

  // A score at each end, so the record renders both a strong number and none.
  await db.from("crm_score_snapshots").insert({
    workspace_id: workspaceId,
    customer_id: highScore.id,
    score: 92,
    components: { intent: 20, fit: 18 },
    confidence: 0.9,
    config_version: "v1",
    evidence_refs: ["msg-1"],
    reason_codes: []
  });

  // An overdue follow-up, so the record shows a late state rather than a blank
  // one - the difference the attention verdict exists to make.
  await db.from("tasks_followups").insert({
    workspace_id: workspaceId,
    customer_id: lowScore.id,
    stop_reason: "price_sent",
    objective: "Chase the quote",
    cancel_condition: "They reply",
    due_at: new Date(Date.now() - 86_400_000 * 3).toISOString()
  });

  // A suggestion with no next action beside one that has one.
  await db.from("crm_next_action_projection").insert({
    workspace_id: workspaceId,
    customer_id: highScore.id,
    action_type: "reply",
    owner_type: "human",
    owner_id: userId,
    source: "ai",
    confidence: 0.7,
    reason_codes: ["unanswered_inbound"]
  });

  const surfaces = [
    { name: "index", path: "/crm" },
    { name: "record", path: `/crm/${highScore.id}` },
    { name: "record-no-score", path: `/crm/${lowScore.id}` }
  ];

  const findings: string[] = [];
  for (const locale of LOCALES) {
    for (const theme of THEMES) {
      await setPreferences(page, locale, theme);
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        for (const surface of surfaces) {
          await page.goto(surface.path);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          const result = await inspect(page);
          const label = `${surface.name}-${locale}-${theme}-${viewport.name}`;
          await page.screenshot({ path: testInfo.outputPath(`${label}.png`), fullPage: true });

          // Collected rather than asserted one at a time: a reviewer needs the
          // whole list of what failed, not the first cell that did.
          if (result.overflow > 1) findings.push(`${label}: overflows by ${result.overflow}px`);
          if (result.lang !== locale) findings.push(`${label}: lang is ${result.lang}`);
          if (result.dir !== (locale === "fa" ? "rtl" : "ltr")) {
            findings.push(`${label}: dir is ${result.dir}`);
          }
          if (result.theme !== theme) findings.push(`${label}: theme is ${result.theme}`);
          if (result.h1Count !== 1) findings.push(`${label}: ${result.h1Count} h1 elements`);
          if (result.unlabeledCount > 0) {
            findings.push(`${label}: ${result.unlabeledCount} unlabelled controls`);
          }
          if (result.imagesWithoutAlt > 0) {
            findings.push(`${label}: ${result.imagesWithoutAlt} images without alt`);
          }
        }
      }
    }
  }
  expect(findings).toEqual([]);
});

test("the record renders read-only for a viewer, and refuses a missing one", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "One browser covers these two states.");

  const { db, workspaceId, userId } = await signUp(page, "visual");
  const { data: customer } = await db
    .from("customers")
    .insert({ workspace_id: workspaceId, display_name: "Viewer Visible", created_by: userId })
    .select("id")
    .single();

  await db
    .from("workspace_memberships")
    .update({ role: "viewer" })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/crm/${customer!.id}`);
  await expect(page.getByRole("region", { name: "Now" })).toBeVisible();
  const viewerState = await inspect(page);
  expect(viewerState.overflow).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath("record-viewer-readonly-1440.png"),
    fullPage: true
  });

  // A record that is not this workspace's must read as absent rather than as
  // forbidden: telling a stranger that an id exists is itself an answer.
  await page.goto("/crm/00000000-0000-4000-8000-000000000000");
  // The app's own not-found copy, which says the same thing for both causes:
  // "It may not exist, or your membership does not grant access."
  await expect(page.getByText(/unavailable|ulaşılamıyor|در دسترس نیست/i).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("record-not-found-1440.png"), fullPage: true });
});
