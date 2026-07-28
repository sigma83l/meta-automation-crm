import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

describe.runIf(enabled)("local Supabase auth and tenant isolation", () => {
  const suffix = randomUUID().slice(0, 8);
  const password = "Correct-Horse-42!";
  const users: string[] = [];
  let admin: SupabaseClient;
  let businessA: SupabaseClient;
  let businessB: SupabaseClient;
  let workspaceA: string;
  let workspaceB: string;

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    businessA = createClient(url!, anonKey!, { auth: { persistSession: false } });
    businessB = createClient(url!, anonKey!, { auth: { persistSession: false } });

    for (const [client, label] of [
      [businessA, "a"],
      [businessB, "b"]
    ] as const) {
      const signup = await client.auth.signUp({
        email: `prompt1-${label}-${suffix}@example.test`,
        password,
        options: { data: { business_name: `Business ${label.toUpperCase()} ${suffix}` } }
      });
      expect(signup.error).toBeNull();
      expect(signup.data.session).not.toBeNull();
      users.push(signup.data.user!.id);
    }
    workspaceA = await resolvedId(businessA);
    workspaceB = await resolvedId(businessB);
  });

  afterAll(async () => {
    for (const userId of users) await admin.auth.admin.deleteUser(userId);
  });

  it("transactionally creates exactly one complete workspace graph", async () => {
    const { data: profiles } = await admin.from("profiles").select("*").in("id", users);
    const { data: memberships } = await admin
      .from("workspace_memberships")
      .select("*")
      .in("user_id", users);
    const { data: settings } = await admin
      .from("workspace_settings")
      .select("*")
      .in("workspace_id", [workspaceA, workspaceB]);
    const { data: onboarding } = await admin
      .from("onboarding_states")
      .select("*")
      .in("user_id", users);
    expect(profiles).toHaveLength(2);
    expect(memberships).toHaveLength(2);
    expect(memberships?.every((row) => row.role === "owner")).toBe(true);
    expect(settings).toHaveLength(2);
    expect(settings?.every((row) => row.email_confirmation_enabled === false)).toBe(true);
    expect(onboarding).toHaveLength(2);
  });

  it("rolls back all setup if trigger initialization fails", async () => {
    const before = await count(admin, "workspaces");
    const failed = await admin.auth.admin.createUser({
      email: `invalid-${suffix}@example.test`,
      password,
      email_confirm: true,
      user_metadata: { business_name: "" }
    });
    expect(failed.error).not.toBeNull();
    expect(await count(admin, "workspaces")).toBe(before);
  });

  it("prevents Business A from reading, updating or deleting Business B", async () => {
    const read = await businessA.from("workspaces").select("id");
    expect(read.data?.map((row) => row.id)).toEqual([workspaceA]);

    const crossUpdate = await businessA
      .from("workspace_settings")
      .update({ timezone: "Europe/Istanbul" })
      .eq("workspace_id", workspaceB)
      .select();
    expect(crossUpdate.data).toEqual([]);
    const insert = await businessA.from("workspaces").insert({ id: workspaceB, name: "Forged" });
    expect(insert.error).not.toBeNull();
    const deletion = await businessA.from("workspaces").delete().eq("id", workspaceB);
    expect(deletion.error).not.toBeNull();
  });

  it("rejects forged workspace hints and fails closed without membership", async () => {
    const forged = await businessA.rpc("resolve_workspace", { workspace_hint: workspaceB });
    expect(forged.data).toEqual([]);

    const orphan = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const created = await orphan.auth.signUp({
      email: `orphan-${suffix}@example.test`,
      password,
      options: { data: { business_name: `Orphan ${suffix}` } }
    });
    users.push(created.data.user!.id);
    await admin.from("workspace_memberships").delete().eq("user_id", created.data.user!.id);
    const unresolved = await orphan.rpc("resolve_workspace", { workspace_hint: null });
    expect(unresolved.data).toEqual([]);
  });

  it("isolates private Storage list, download, signed URL and writes", async () => {
    const path = `${workspaceA}/conversation/test.png`;
    const uploaded = await businessA.storage
      .from("crm-private")
      .upload(path, new Uint8Array([137, 80, 78, 71]), { contentType: "image/png" });
    expect(uploaded.error).toBeNull();
    expect(
      (await businessA.storage.from("crm-private").list(`${workspaceA}/conversation`)).data
    ).toHaveLength(1);
    expect(
      (await businessB.storage.from("crm-private").list(`${workspaceA}/conversation`)).data
    ).toEqual([]);
    expect((await businessB.storage.from("crm-private").download(path)).error).not.toBeNull();
    expect(
      (await businessB.storage.from("crm-private").createSignedUrl(path, 60)).error
    ).not.toBeNull();
    expect(
      (
        await businessB.storage
          .from("crm-private")
          .upload(`${workspaceA}/conversation/forged.png`, new Uint8Array([1]), {
            contentType: "image/png"
          })
      ).error
    ).not.toBeNull();
    expect((await businessA.storage.from("crm-private").remove([path])).error).toBeNull();
  });

  it("supports login, refresh, recovery request, logout and expired-session denial", async () => {
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    expect(
      (
        await client.auth.signInWithPassword({
          email: `prompt1-a-${suffix}@example.test`,
          password
        })
      ).error
    ).toBeNull();
    expect((await client.auth.refreshSession()).error).toBeNull();
    expect(
      (await client.auth.resetPasswordForEmail(`prompt1-a-${suffix}@example.test`)).error
    ).toBeNull();
    expect((await client.auth.signOut({ scope: "global" })).error).toBeNull();
    expect((await client.rpc("resolve_workspace", { workspace_hint: null })).data).toEqual([]);
  });

  it("fails closed for a disabled account", async () => {
    await admin.from("profiles").update({ status: "disabled" }).eq("id", users[0]);
    expect((await businessA.rpc("resolve_workspace", { workspace_hint: null })).data).toEqual([]);
    await admin.from("profiles").update({ status: "active" }).eq("id", users[0]);
  });
});

async function resolvedId(client: SupabaseClient) {
  let result = await client.rpc("resolve_workspace", { workspace_hint: null });
  if (result.error?.code === "PGRST303") {
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    result = await client.rpc("resolve_workspace", { workspace_hint: null });
  }
  const { data, error } = result;
  expect(error).toBeNull();
  return (data as { workspace_id: string }[])[0]!.workspace_id;
}

async function count(client: SupabaseClient, table: string) {
  const { count: value } = await client.from(table).select("*", { count: "exact", head: true });
  return value;
}
