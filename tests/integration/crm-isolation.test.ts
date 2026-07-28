import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

describe.runIf(enabled)("CRM, inbox, media and export tenant isolation", () => {
  const suffix = randomUUID().slice(0, 8);
  const password = "Correct-Horse-42!";
  const users: string[] = [];
  let admin: SupabaseClient;
  let businessA: SupabaseClient;
  let businessB: SupabaseClient;
  let workspaceA: string;
  let workspaceB: string;
  let customerA: string;
  let customerB: string;

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    businessA = createClient(url!, anonKey!, { auth: { persistSession: false } });
    businessB = createClient(url!, anonKey!, { auth: { persistSession: false } });
    for (const [client, label] of [
      [businessA, "a"],
      [businessB, "b"]
    ] as const) {
      const signup = await client.auth.signUp({
        email: `crm-${label}-${suffix}@example.test`,
        password,
        options: { data: { business_name: `CRM ${label.toUpperCase()} ${suffix}` } }
      });
      expect(signup.error).toBeNull();
      expect(signup.data.user).not.toBeNull();
      users.push(signup.data.user!.id);
    }
    workspaceA = await resolvedId(businessA);
    workspaceB = await resolvedId(businessB);
    customerA = await createCustomer(businessA, workspaceA, users[0]!, "Customer A");
    customerB = await createCustomer(businessB, workspaceB, users[1]!, "Customer B");
  });

  afterAll(async () => {
    for (const user of users) await admin.auth.admin.deleteUser(user);
  });

  it("creates, edits and reloads customer data with identity, fields and consent", async () => {
    await businessA.from("customer_channel_identities").insert({
      workspace_id: workspaceA,
      customer_id: customerA,
      channel: "instagram",
      external_id: `ig-${suffix}`,
      username: "synthetic_a"
    });
    const definition = await businessA
      .from("custom_field_definitions")
      .insert({ workspace_id: workspaceA, name: "Tier", field_key: "tier", field_type: "text" })
      .select("id")
      .single();
    await businessA.from("customer_custom_field_values").insert({
      workspace_id: workspaceA,
      customer_id: customerA,
      definition_id: definition.data!.id,
      value: "gold"
    });
    await businessA.from("customer_consents").insert({
      workspace_id: workspaceA,
      customer_id: customerA,
      channel: "whatsapp",
      status: "revoked",
      opt_out: true
    });
    await businessA
      .from("customers")
      .update({ company_name: "Reloaded Synthetic" })
      .eq("id", customerA);
    expect(
      (await businessA.from("customers").select("company_name").eq("id", customerA).single()).data
        ?.company_name
    ).toBe("Reloaded Synthetic");
    expect((await businessA.from("customer_channel_identities").select("*")).data).toHaveLength(1);
    expect(
      (await businessA.from("customer_custom_field_values").select("*")).data?.[0]?.value
    ).toBe("gold");
    expect((await businessA.from("customer_consents").select("*")).data?.[0]?.opt_out).toBe(true);
  });

  it("stores messages and timeline with inbox ownership states", async () => {
    const conversation = await businessA
      .from("conversations")
      .insert({
        workspace_id: workspaceA,
        customer_id: customerA,
        channel: "whatsapp",
        owner: "human",
        unread_count: 2,
        requires_human_review: true
      })
      .select("id")
      .single();
    await businessA.from("messages").insert({
      workspace_id: workspaceA,
      customer_id: customerA,
      conversation_id: conversation.data!.id,
      direction: "inbound",
      status: "received",
      body: "Synthetic hello"
    });
    await businessA.from("customer_activities").insert({
      workspace_id: workspaceA,
      customer_id: customerA,
      activity_type: "message.received",
      summary: "Inbound fixture received"
    });
    expect(
      (await businessA.from("messages").select("*").eq("conversation_id", conversation.data!.id))
        .data
    ).toHaveLength(1);
    expect(
      (await businessA.from("customer_activities").select("*").eq("customer_id", customerA)).data
    ).toHaveLength(1);
  });

  it("denies Business A query, search, mutation and export access to Business B", async () => {
    expect((await businessA.from("customers").select("*").eq("id", customerB)).data).toEqual([]);
    expect(
      (await businessA.from("customers").select("*").ilike("display_name", "%Customer B%")).data
    ).toEqual([]);
    expect(
      (
        await businessA
          .from("customers")
          .update({ display_name: "Forged" })
          .eq("id", customerB)
          .select()
      ).data
    ).toEqual([]);
    expect((await businessA.from("customers").delete().eq("id", customerB).select()).data).toEqual(
      []
    );
    expect(
      (
        await businessA
          .from("customers")
          .insert({ workspace_id: workspaceB, display_name: "Forged", created_by: users[0] })
      ).error
    ).not.toBeNull();
    expect(
      (await businessA.from("export_jobs").select("*").eq("workspace_id", workspaceB)).data
    ).toEqual([]);
  });

  it("isolates media upload, list, sign and download", async () => {
    const path = `${workspaceA}/${customerA}/fixture.png`;
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(
      (
        await businessA.storage
          .from("customer-media")
          .upload(path, bytes, { contentType: "image/png" })
      ).error
    ).toBeNull();
    expect(
      (await businessB.storage.from("customer-media").list(`${workspaceA}/${customerA}`)).data
    ).toEqual([]);
    expect((await businessB.storage.from("customer-media").download(path)).error).not.toBeNull();
    expect(
      (await businessB.storage.from("customer-media").createSignedUrl(path, 60)).error
    ).not.toBeNull();
    expect((await businessA.storage.from("customer-media").remove([path])).error).toBeNull();
  });

  it("denies expired or cross-workspace export metadata", async () => {
    const job = await businessA
      .from("export_jobs")
      .insert({
        workspace_id: workspaceA,
        requested_by: users[0],
        scope: "workspace",
        status: "ready",
        object_path: `${workspaceA}/expired.zip`,
        expires_at: new Date(0).toISOString()
      })
      .select("id")
      .single();
    expect(
      new Date(
        (await businessA.from("export_jobs").select("expires_at").eq("id", job.data!.id).single())
          .data!.expires_at
      ).getTime()
    ).toBeLessThan(Date.now());
    expect((await businessB.from("export_jobs").select("*").eq("id", job.data!.id)).data).toEqual(
      []
    );
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
  expect(data).not.toBeNull();
  return (data as { workspace_id: string }[])[0]!.workspace_id;
}

async function createCustomer(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
  displayName: string
) {
  const result = await client
    .from("customers")
    .insert({ workspace_id: workspaceId, display_name: displayName, created_by: userId })
    .select("id")
    .single();
  return result.data!.id;
}
