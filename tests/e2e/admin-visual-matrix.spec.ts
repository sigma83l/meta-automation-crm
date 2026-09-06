import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { admin, setPreferences, signUp } from "./support/workspace";

/**
 * The platform console, rendered across every locale, theme and width.
 *
 * `tests/e2e/admin-console.spec.ts` proves the console's tables are tables -
 * each heading sits over its own column, in both writing directions. That is
 * the property a machine can decide. It says nothing about whether the console
 * reads as a designed surface, and the console is the one place in this product
 * where a staff member acts on somebody else's customers: a screen that looks
 * unfinished there is a screen people distrust and work around.
 *
 * So this renders all seven sections at EN/TR/FA x Light/Dark x 1440/1024/390,
 * checks what is decidable, and writes every frame to disk for the review a
 * machine cannot perform. Same division of labour as
 * `crm-visual-matrix.spec.ts`, and deliberately the same shape, so a reviewer
 * moving between the two is reading one artefact set rather than two.
 *
 * The seeded state is hostile on purpose - a workspace name at the 80-character
 * ceiling the table allows, a Persian name that breaks a column in the other
 * direction, a suspended workspace beside an active one, an unrecovered dead
 * letter, an open impersonation grant, and enough audit rows that the eight
 * column ledger has to lay out real values rather than an empty state.
 */

const LOCALES = ["en", "tr", "fa"] as const;
const THEMES = ["light", "dark"] as const;
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 1000 },
  // The width where the rail is still present and the content column is at its
  // narrowest - where a table that survives both extremes can still fail.
  { name: "1024", width: 1024, height: 768 },
  { name: "390", width: 390, height: 844 }
] as const;

/**
 * `workspaces_name_check` caps a name at 80 characters, so the hostile case is
 * a name at the ceiling rather than past it: the longest value the product will
 * ever have to lay out.
 */
const LONG_NAME = "Northern Districts Manufacturing & Logistics Partnership (Holdings) Limited";
const PERSIAN_NAME = "شرکت مهندسی و بازرگانی پیشگامان توسعه پایدار خاورمیانه";

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Chromium carries the visual matrix.");
});

/** Grants staff access the way the bootstrap script does - through service role. */
async function grantStaff(db: SupabaseClient, userId: string, role = "platform_owner") {
  const { error } = await db
    .from("platform_admins")
    .insert({ user_id: userId, role, status: "active", granted_reason: "visual matrix" });
  expect(error).toBeNull();
}

/**
 * A second and third tenant, so every directory has more than one row in it.
 *
 * Built through service role rather than by signing up twice more: signup is
 * eight seconds of wizard per tenant and this needs neither the wizard nor a
 * usable session for them - only rows that look like production.
 */
async function seedTenants(db: SupabaseClient) {
  const made: { id: string; name: string }[] = [];
  const specs = [
    { name: LONG_NAME, status: "active", subscription: "past_due" },
    { name: PERSIAN_NAME, status: "active", subscription: "trialing" },
    { name: "Suspended Studio", status: "disabled", subscription: "suspended" }
  ] as const;

  for (const spec of specs) {
    const { data: workspace, error } = await db
      .from("workspaces")
      .insert({ name: spec.name, status: spec.status })
      .select("id,name")
      .single();
    expect(error).toBeNull();
    const id = String(workspace!.id);
    made.push({ id, name: String(workspace!.name) });

    // A member apiece, because a directory row reporting zero people reads as a
    // broken join rather than as an empty tenant.
    const { data: created } = await db.auth.admin.createUser({
      email: `seed-${randomUUID()}@example.test`,
      password: "Correct-Horse-42!",
      email_confirm: true
    });
    const memberId = created?.user?.id;
    if (memberId) {
      await db
        .from("profiles")
        .upsert({ id: memberId, workspace_id: id, display_name: spec.name, status: "active" });
      await db.from("workspace_memberships").insert({
        workspace_id: id,
        user_id: memberId,
        role: "owner",
        status: "active"
      });
    }

    await db.from("workspace_subscriptions").insert({
      workspace_id: id,
      status: spec.subscription,
      ...(spec.subscription === "trialing"
        ? { trial_ends_at: new Date(Date.now() + 86_400_000 * 5).toISOString() }
        : {})
    });
  }
  return made;
}

/**
 * An unrecovered dead letter, which the System page's widest table exists to
 * show and which cannot be inserted on its own: it is keyed to a real run,
 * which needs a version, an automation and a conversation under it.
 */
async function seedDeadLetter(db: SupabaseClient, workspaceId: string, userId: string) {
  const { data: customer } = await db
    .from("customers")
    .insert({ workspace_id: workspaceId, display_name: "Dead Letter Contact", created_by: userId })
    .select("id")
    .single();
  const { data: conversation } = await db
    .from("conversations")
    .insert({
      workspace_id: workspaceId,
      customer_id: customer!.id,
      channel: "whatsapp",
      state: "open",
      owner: "automation"
    })
    .select("id")
    .single();
  const { data: automation } = await db
    .from("automations")
    .insert({
      workspace_id: workspaceId,
      name: "After-hours escalation",
      recipe: "CROSS_CHANNEL_AFTER_HOURS_ESCALATION",
      status: "ACTIVE"
    })
    .select("id")
    .single();
  const { data: version } = await db
    .from("automation_versions")
    .insert({
      workspace_id: workspaceId,
      automation_id: automation!.id,
      version: 1,
      configuration: {},
      content_hash: randomUUID()
    })
    .select("id")
    .single();
  const { data: run } = await db
    .from("automation_runs")
    .insert({
      workspace_id: workspaceId,
      automation_id: automation!.id,
      automation_version_id: version!.id,
      conversation_id: conversation!.id,
      state: "FAILED",
      collected_fields: {},
      failure_code: "PROVIDER_TIMEOUT"
    })
    .select("id")
    .single();
  const { error } = await db.from("automation_dead_letters").insert({
    workspace_id: workspaceId,
    run_id: run!.id,
    error_code: "PROVIDER_TIMEOUT",
    safe_summary: "The provider accepted the request and never answered.",
    recoverable: false
  });
  expect(error).toBeNull();
}

/** Ledger rows, so the audit table lays out real values across all eight columns. */
async function seedAudit(db: SupabaseClient, actorId: string, workspaceIds: readonly string[]) {
  const actions = [
    "workspace.suspend",
    "workspace.restore",
    "feature.override_set",
    "subscription.transition",
    "impersonation.grant",
    "staff.grant"
  ];
  const rows = actions.map((action, index) => ({
    actor_id: actorId,
    actor_role: "platform_owner",
    action,
    target_workspace_id: workspaceIds[index % workspaceIds.length] ?? null,
    safe_details: { reason: "Recorded while building the visual matrix", index },
    occurred_at: new Date(Date.now() - index * 3_600_000).toISOString()
  }));
  const { error } = await db.from("platform_admin_audit_events").insert(rows);
  expect(error).toBeNull();
}

/** The checks a machine can decide, run on whatever is on screen. */
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
      brokenImages: [...document.querySelectorAll("img")].filter(
        (image) => image.complete && image.naturalWidth === 0
      ).length
    };
  });
}

test("the console across EN/TR/FA, light and dark, at three widths", async ({ page }, testInfo) => {
  test.setTimeout(600_000);

  const { db, userId, workspaceId } = await signUp(page, "admin-visual");
  await grantStaff(db, userId);
  const tenants = await seedTenants(db);
  await seedDeadLetter(db, workspaceId, userId);
  await seedAudit(db, userId, [workspaceId, ...tenants.map((tenant) => tenant.id)]);

  // An open grant, so the overview renders its live-view panel and the rail
  // renders the banner that names whose data is on screen.
  const service = admin();
  await service.from("platform_impersonation_grants").insert({
    admin_id: userId,
    workspace_id: tenants[0]!.id,
    reason: "Investigating a delivery complaint",
    expires_at: new Date(Date.now() + 1_800_000).toISOString()
  });
  // One feature turned off for a tenant, so the catalogue shows an override
  // count rather than zeroes across the board.
  await service.from("workspace_feature_overrides").insert({
    workspace_id: tenants[0]!.id,
    flag_key: "crm_export",
    enabled: false,
    reason: "Export withheld pending a billing dispute",
    set_by: userId
  });

  const surfaces = [
    { name: "overview", path: "/admin" },
    { name: "workspaces", path: "/admin/workspaces" },
    { name: "workspace-detail", path: `/admin/workspaces/${tenants[0]!.id}` },
    { name: "users", path: "/admin/users" },
    { name: "features", path: "/admin/features" },
    { name: "system", path: "/admin/system" },
    { name: "audit", path: "/admin/audit" },
    { name: "staff", path: "/admin/staff" }
  ] as const;

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

          if (result.overflow > 1)
            findings.push(`${label}: page overflows by ${result.overflow}px`);
          if (result.h1Count !== 1) findings.push(`${label}: ${result.h1Count} h1 elements`);
          if (result.unlabeledCount > 0) {
            findings.push(`${label}: ${result.unlabeledCount} unlabelled controls`);
          }
          if (result.brokenImages > 0) {
            findings.push(`${label}: ${result.brokenImages} images failed to load`);
          }
          const expectedDir = locale === "fa" ? "rtl" : "ltr";
          if (result.dir !== expectedDir) {
            findings.push(`${label}: dir="${result.dir}", expected "${expectedDir}"`);
          }
          if (result.theme !== theme) {
            findings.push(`${label}: theme="${result.theme}", expected "${theme}"`);
          }
          if (result.lang !== locale) {
            findings.push(`${label}: lang="${result.lang}", expected "${locale}"`);
          }
        }
      }
    }
  }

  expect(findings, findings.join("\n")).toEqual([]);
});
