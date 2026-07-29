import { createHash, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

describe.runIf(enabled)("Prompt 8 production hardening", () => {
  const suffix = randomUUID().slice(0, 8);
  const password = "Correct-Horse-42!";
  const userIds: string[] = [];
  let admin: SupabaseClient;
  let businessA: SupabaseClient;
  let businessB: SupabaseClient;
  let workspaceA: string;

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    businessA = createClient(url!, anonKey!, { auth: { persistSession: false } });
    businessB = createClient(url!, anonKey!, { auth: { persistSession: false } });
    for (const [client, label] of [
      [businessA, "a"],
      [businessB, "b"]
    ] as const) {
      const signup = await client.auth.signUp({
        email: `hardening-${label}-${suffix}@example.test`,
        password,
        options: { data: { business_name: `Hardening ${label.toUpperCase()} ${suffix}` } }
      });
      expect(signup.error).toBeNull();
      userIds.push(signup.data.user!.id);
    }
    workspaceA = await resolvedId(businessA);
  });

  afterAll(async () => {
    for (const userId of userIds) await admin.auth.admin.deleteUser(userId);
  });

  it("uses one atomic limiter across anonymous clients without storing raw identities", async () => {
    const key = createHash("sha256").update(`synthetic-${suffix}`).digest("hex");
    const first = await businessA.rpc("consume_auth_rate_limit", {
      requested_key_hash: key,
      requested_maximum: 1,
      requested_window_seconds: 60
    });
    const second = await businessB.rpc("consume_auth_rate_limit", {
      requested_key_hash: key,
      requested_maximum: 1,
      requested_window_seconds: 60
    });
    expect(first.data).toBe(true);
    expect(second.data).toBe(false);
    expect(first.error).toBeNull();
  });

  it("allows only the trusted server to run an atomic workspace import", async () => {
    const parameters = {
      trusted_workspace_id: workspaceA,
      trusted_requested_by: userIds[0],
      requested_source_name: "synthetic.csv",
      requested_rows: [
        {
          displayName: "Synthetic Ada",
          companyName: "Example Lab",
          email: "ada@example.test",
          phone: "+10000000000"
        }
      ]
    };
    expect((await businessA.rpc("import_crm_rows", parameters)).error).not.toBeNull();
    const imported = await admin.rpc("import_crm_rows", parameters);
    expect(imported.error).toBeNull();
    expect(imported.data).toMatchObject([
      { job_status: "completed", accepted_rows: 1, rejected_rows: 0 }
    ]);
  });

  it("keeps imported customers and import audit jobs inside Business A", async () => {
    const customerA = await businessA
      .from("customers")
      .select("display_name")
      .eq("display_name", "Synthetic Ada");
    expect(customerA.data).toEqual([{ display_name: "Synthetic Ada" }]);
    expect(
      (await businessB.from("customers").select("display_name").eq("display_name", "Synthetic Ada"))
        .data
    ).toEqual([]);
    expect((await businessA.from("crm_import_jobs").select("status")).data).toEqual([
      { status: "completed" }
    ]);
    expect((await businessB.from("crm_import_jobs").select("status")).data).toEqual([]);
  });

  it("lets viewers read their workspace but denies CRM and settings mutations", async () => {
    const viewer = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signup = await viewer.auth.signUp({
      email: `viewer-${suffix}@example.test`,
      password,
      options: { data: { business_name: `Temporary Viewer ${suffix}` } }
    });
    expect(signup.error).toBeNull();
    const viewerId = signup.data.user!.id;
    userIds.push(viewerId);
    const temporaryWorkspace = await resolvedId(viewer);
    await admin
      .from("onboarding_states")
      .delete()
      .eq("workspace_id", temporaryWorkspace)
      .eq("user_id", viewerId);
    await admin
      .from("workspace_memberships")
      .delete()
      .eq("workspace_id", temporaryWorkspace)
      .eq("user_id", viewerId);
    expect(
      (await admin.from("profiles").update({ workspace_id: workspaceA }).eq("id", viewerId)).error
    ).toBeNull();
    expect(
      (
        await admin.from("workspace_memberships").insert({
          workspace_id: workspaceA,
          user_id: viewerId,
          role: "viewer"
        })
      ).error
    ).toBeNull();
    await admin.from("workspaces").delete().eq("id", temporaryWorkspace);

    expect((await viewer.from("customers").select("display_name")).data).toEqual([
      { display_name: "Synthetic Ada" }
    ]);
    expect(
      (
        await viewer.from("customers").insert({
          workspace_id: workspaceA,
          display_name: "Forbidden Viewer Write",
          created_by: viewerId
        })
      ).error
    ).not.toBeNull();
    const forbiddenSettingsUpdate = await viewer
      .from("business_profiles")
      .update({ brand_name: "Forbidden Viewer Brand" })
      .eq("workspace_id", workspaceA)
      .select();
    expect(forbiddenSettingsUpdate.error).toBeNull();
    expect(forbiddenSettingsUpdate.data).toEqual([]);
  });
});

async function resolvedId(client: SupabaseClient) {
  const { data, error } = await client.rpc("resolve_workspace", { workspace_hint: null });
  expect(error).toBeNull();
  return (data as { workspace_id: string }[])[0]!.workspace_id;
}
