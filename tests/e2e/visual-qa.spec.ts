import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const variants = [
  { locale: "en", theme: "light", dir: "ltr" },
  { locale: "en", theme: "dark", dir: "ltr" },
  { locale: "tr", theme: "light", dir: "ltr" },
  { locale: "tr", theme: "dark", dir: "ltr" },
  { locale: "fa", theme: "light", dir: "rtl" },
  { locale: "fa", theme: "dark", dir: "rtl" }
] as const;

test("owner routes fit desktop, tablet, mobile and RTL without horizontal overflow", async ({
  page
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "One browser covers the explicit viewport matrix."
  );

  await page.goto("/signup");
  await page.getByLabel("Business name").fill("Visual QA Synthetic");
  await page.getByLabel("Email").fill(`visual-${randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("Correct-Horse-42!");
  await page.getByRole("button", { name: "Create private workspace" }).click();
  await page.getByRole("button", { name: "Save and exit" }).click();
  await expect(page).toHaveURL(/dashboard/);

  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "compact", width: 1024, height: 768 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    if (viewport.width >= 761 && viewport.width <= 1050) {
      const compactRail = await page.evaluate(() => {
        const rail = document.querySelector<HTMLElement>(".control-rail");
        const workspace = document.querySelector<HTMLElement>(".workspace-card");
        const links = [...document.querySelectorAll<HTMLElement>(".control-rail nav a")];
        return {
          railWidth: rail?.getBoundingClientRect().width ?? 0,
          workspaceDisplay: workspace ? getComputedStyle(workspace).display : "missing",
          visibleLinkLabels: links.filter(
            (link) => Number.parseFloat(getComputedStyle(link).fontSize) > 0
          ).length
        };
      });
      expect(compactRail).toEqual({
        railWidth: 76,
        workspaceDisplay: "none",
        visibleLinkLabels: 0
      });
    }
    await page.screenshot({
      path: testInfo.outputPath(`overview-${viewport.name}.png`),
      fullPage: true,
      animations: "disabled",
      caret: "initial"
    });

    await page.goto("/automations");
    await expect(page.getByRole("heading", { name: "Automations", level: 1 })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`automations-${viewport.name}.png`),
      fullPage: true,
      animations: "disabled",
      caret: "initial"
    });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();

  await page.goto("/automations");
  await page.context().addCookies([
    {
      name: "relay_locale",
      value: "fa",
      domain: "127.0.0.1",
      path: "/",
      sameSite: "Lax"
    }
  ]);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  const accessibilitySmoke = await page.evaluate(() => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    };
    const controls = [...document.querySelectorAll("button,a,input,select,textarea")].filter(
      visible
    );
    const unlabeled = controls.filter((element) => {
      if (element instanceof HTMLInputElement && element.type === "hidden") return false;
      const labelledBy = element.getAttribute("aria-labelledby");
      const explicitLabel =
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
          ? Boolean(element.labels?.length)
          : false;
      return !(
        element.getAttribute("aria-label") ||
        labelledBy ||
        explicitLabel ||
        element.textContent?.trim() ||
        element.getAttribute("title")
      );
    });
    return {
      lang: document.documentElement.lang,
      h1Count: document.querySelectorAll("h1").length,
      unlabeledCount: unlabeled.length,
      imagesWithoutAlt: [...document.querySelectorAll("img")].filter(
        (image) => !image.hasAttribute("alt")
      ).length
    };
  });
  expect(accessibilitySmoke).toEqual({
    lang: "fa",
    h1Count: 1,
    unlabeledCount: 0,
    imagesWithoutAlt: 0
  });
  const semanticFocusOrder = await page.evaluate(() => {
    const brand = document.querySelector<HTMLAnchorElement>(".brand-lockup");
    const signOut = document.querySelector<HTMLButtonElement>(".topbar button");
    return {
      brandTabIndex: brand?.tabIndex,
      signOutTabIndex: signOut?.tabIndex,
      brandBeforeSignOut:
        brand && signOut
          ? Boolean(brand.compareDocumentPosition(signOut) & Node.DOCUMENT_POSITION_FOLLOWING)
          : false
    };
  });
  expect(semanticFocusOrder).toEqual({
    brandTabIndex: 0,
    signOutTabIndex: 0,
    brandBeforeSignOut: true
  });
  await page.screenshot({
    path: testInfo.outputPath("automations-mobile-rtl.png"),
    fullPage: true,
    animations: "disabled",
    caret: "initial"
  });

  for (const variant of variants) {
    await page.context().addCookies([
      {
        name: "relay_locale",
        value: variant.locale,
        domain: "127.0.0.1",
        path: "/",
        sameSite: "Lax"
      },
      {
        name: "relay_theme",
        value: variant.theme,
        domain: "127.0.0.1",
        path: "/",
        sameSite: "Lax"
      }
    ]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    await expect(page.locator("html")).toHaveAttribute("lang", variant.locale);
    await expect(page.locator("html")).toHaveAttribute("dir", variant.dir);
    await expect(page.locator("html")).toHaveAttribute("data-theme", variant.theme);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`overview-${variant.locale}-${variant.theme}-1440.png`),
      fullPage: true,
      animations: "disabled",
      caret: "initial"
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`overview-${variant.locale}-${variant.theme}-390.png`),
      fullPage: true,
      animations: "disabled",
      caret: "initial"
    });
  }
});

test("every real route has stable six-variant desktop and mobile visual evidence", async ({
  page
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "One browser owns the deterministic production visual matrix."
  );
  test.setTimeout(480_000);

  const email = `visual-matrix-${randomUUID()}@example.test`;
  await page.goto("/signup");
  await page.getByLabel("Business name").fill("Visual Matrix Synthetic");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Correct-Horse-42!");
  await page.getByRole("button", { name: "Create private workspace" }).click();
  await page.getByRole("button", { name: "Save and exit" }).click();
  await expect(page).toHaveURL(/dashboard/);

  await page.goto("/automations");
  await page.getByLabel("Automation name").fill("Visual matrix automation");
  for (let step = 0; step < 6; step++) {
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await page.getByRole("button", { name: "Create draft" }).click();
  const automationHref = await page
    .getByRole("link", { name: /Visual matrix automation/ })
    .getAttribute("href");
  expect(automationHref).toMatch(/^\/automations\/[0-9a-f-]+$/);

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
  if (!profile.data) throw new Error("Synthetic visual workspace was not provisioned.");
  const customer = await admin
    .from("customers")
    .insert({
      workspace_id: profile.data.workspace_id,
      display_name: "Visual Matrix Customer",
      company_name: "Synthetic Studio",
      source: "visual-e2e",
      created_by: user!.id
    })
    .select("id")
    .single();
  expect(customer.error).toBeNull();
  if (!customer.data) throw new Error("Synthetic visual customer was not created.");
  const conversation = await admin
    .from("conversations")
    .insert({
      workspace_id: profile.data.workspace_id,
      customer_id: customer.data.id,
      channel: "instagram",
      requires_human_review: true,
      owner: "human"
    })
    .select("id")
    .single();
  expect(conversation.error).toBeNull();
  if (!conversation.data) throw new Error("Synthetic visual conversation was not created.");

  const routes = [
    ["entry", "/"],
    ["login", "/login"],
    ["signup", "/signup"],
    ["forgot-password", "/forgot-password"],
    ["reset-password", "/reset-password"],
    ["onboarding", "/onboarding"],
    ["overview", "/dashboard"],
    ["inbox-list", "/inbox"],
    ["inbox-active", `/inbox?conversation=${conversation.data.id}`],
    ["automations", "/automations"],
    ["recipes", "/automations/recipes"],
    ["test-center", "/automations/test-center"],
    ["automation-detail", automationHref!],
    ["automation-runs", `${automationHref!}?tab=runs`],
    ["automation-versions", `${automationHref!}?tab=versions`],
    ["automation-issues", `${automationHref!}?tab=issues`],
    ["customers", "/crm"],
    ["customer-detail", `/crm/${customer.data.id}`],
    ["customer-files", `/crm/${customer.data.id}?tab=Files`],
    ["analytics", "/analytics"],
    ["integrations", "/connections"],
    ["settings", "/settings"],
    ["not-found", "/visual-review-not-found"]
  ] as const;
  const denseRoutes = new Set(["inbox-active", "automations", "customer-detail", "settings"]);
  const browserErrors: string[] = [];
  const runtimeErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "unknown";
    const url = new URL(request.url());
    const isCancelledNextPrefetch =
      failure === "net::ERR_ABORTED" &&
      url.origin === "http://127.0.0.1:3000" &&
      url.searchParams.has("_rsc");
    if (!isCancelledNextPrefetch) {
      failedRequests.push(`${request.method()} ${request.url()} ${failure}`);
    }
  });

  for (const variant of variants) {
    await page.context().addCookies([
      {
        name: "relay_locale",
        value: variant.locale,
        domain: "127.0.0.1",
        path: "/",
        sameSite: "Lax"
      },
      {
        name: "relay_theme",
        value: variant.theme,
        domain: "127.0.0.1",
        path: "/",
        sameSite: "Lax"
      }
    ]);
    for (const [name, route] of routes) {
      const viewports = [
        { label: "1440", width: 1440, height: 900 },
        { label: "390", width: 390, height: 844 },
        ...(denseRoutes.has(name)
          ? [
              { label: "1280", width: 1280, height: 1024 },
              { label: "1024", width: 1024, height: 768 },
              { label: "768", width: 768, height: 1024 }
            ]
          : [])
      ];
      for (const viewport of viewports) {
        browserErrors.length = 0;
        runtimeErrors.length = 0;
        failedRequests.length = 0;
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const response = await page.goto(route, { waitUntil: "domcontentloaded" });
        expect(response?.status(), `${name} returned an unexpected response`).toBeLessThan(500);
        await expect(page.locator("body")).toBeVisible();
        const routeLoading = page.locator('[aria-busy="true"]');
        if (await routeLoading.count()) await expect(routeLoading).toBeHidden();
        await expect(page.locator("html")).toHaveAttribute("lang", variant.locale);
        await expect(page.locator("html")).toHaveAttribute("dir", variant.dir);
        await expect(page.locator("html")).toHaveAttribute("data-theme", variant.theme);
        await page.screenshot({
          path: testInfo.outputPath(
            `matrix-${name}-${variant.locale}-${variant.theme}-${viewport.label}.png`
          ),
          fullPage: true,
          animations: "disabled",
          caret: "initial"
        });
        const layout = await page.evaluate(() => ({
          innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          offenders: [...document.querySelectorAll("body *")]
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              return rect.right > innerWidth + 1 || rect.left < -1;
            })
            .slice(0, 8)
            .map((element) => ({
              tag: element.tagName,
              className: element.className,
              text: element.textContent?.trim().slice(0, 80)
            }))
        }));
        expect(
          layout.scrollWidth,
          `${name} ${variant.locale}/${variant.theme} ${viewport.label}px overflowed: ${JSON.stringify(layout.offenders)}`
        ).toBeLessThanOrEqual(layout.innerWidth);
        expect(runtimeErrors, `${name} raised a page error`).toEqual([]);
        const unexpectedBrowserErrors = browserErrors.filter(
          (message) => !(name === "not-found" && message.includes("status of 404"))
        );
        expect(unexpectedBrowserErrors, `${name} logged a console error`).toEqual([]);
        expect(failedRequests, `${name} had a failed asset or request`).toEqual([]);
      }
    }
  }
});
