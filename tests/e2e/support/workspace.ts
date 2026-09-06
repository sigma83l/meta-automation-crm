import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";

/**
 * Getting a signed-in owner with a workspace, which every CRM journey needs
 * before it can start.
 *
 * Shared rather than copied into each spec: the signup submit has one
 * non-obvious hazard in it, and a second copy is a second place to not know
 * about it.
 */

export const PASSWORD = "Correct-Horse-42!";

/**
 * A service-role client, for seeding states the product cannot yet create and
 * for reading back what a journey was supposed to write.
 *
 * Only ever in test code. Nothing in the browser holds this key.
 */
export function admin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Local Supabase env missing; run through pnpm test:e2e.");
  return createClient(url, key, { auth: { persistSession: false } });
}

export type Owner = Readonly<{
  db: SupabaseClient;
  email: string;
  userId: string;
  workspaceId: string;
}>;

/** Signs a new owner up and returns the workspace the signup provisioned. */
export async function signUp(page: Page, label: string): Promise<Owner> {
  const email = `crm-${label}-${randomUUID()}@example.test`;

  // Retried, because of one race that is entirely real and not a flake to be
  // waited out: the submit button is a real submit button inside a form whose
  // handler calls preventDefault. Before React hydrates, clicking it performs a
  // native GET to /signup - which clears the three fields and leaves the test
  // looking at an empty form with no error on it. Filling and clicking again
  // after hydration is the whole fix; a longer timeout cannot help, because
  // nothing further is going to happen.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto("/signup");
    await page.getByLabel("Business name").fill(`Flow ${label}`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create private workspace" }).click();
    try {
      await page.waitForURL(/\/onboarding/, { timeout: 15_000 });
      break;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
  // The same race again, one page later, and it fails differently: leaving
  // onboarding before hydration performs a native submit that lands back on
  // /onboarding, so the click is retried until the URL actually leaves.
  //
  // What is no longer here is a second wait for the bounce to settle. Save and
  // exit used to land on /dashboard and be redirected straight back, because
  // nothing but the eighth stage opened the account gate; the helper had to
  // wait out the round trip or have its next `goto` aborted mid-navigation.
  // The button now opens the gate it always claimed to, so leaving is one
  // navigation and waiting for it to finish is the whole story.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.getByRole("button", { name: "Save and exit" }).click();
    try {
      await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
      break;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }

  const db = admin();
  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 });
  const user = users.users.find((candidate) => candidate.email === email);
  if (!user) throw new Error(`No auth user for ${email}`);
  const { data: profile } = await db
    .from("profiles")
    .select("workspace_id")
    .eq("id", user.id)
    .single();
  return { db, email, userId: user.id, workspaceId: String(profile?.workspace_id) };
}

/** Creates a contact through the form and returns its id. */
export async function createCustomer(
  page: Page,
  db: SupabaseClient,
  workspaceId: string,
  name: string
): Promise<string> {
  await page.goto("/crm");
  await page.getByPlaceholder("Display name").fill(name);
  await page.getByPlaceholder("Company", { exact: true }).fill("Flow Labs");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("link", { name })).toBeVisible();
  const { data } = await db
    .from("customers")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("display_name", name)
    .single();
  return String(data?.id);
}

/** Sets the locale and theme the way the preference controls do. */
export async function setPreferences(page: Page, locale: string, theme: string) {
  await page.context().addCookies([
    { name: "relay_locale", value: locale, domain: "127.0.0.1", path: "/", sameSite: "Lax" },
    { name: "relay_theme", value: theme, domain: "127.0.0.1", path: "/", sameSite: "Lax" }
  ]);
}
