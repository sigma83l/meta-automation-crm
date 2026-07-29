import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseMetaWebhookRepository } from "@/src/modules/integrations/meta/webhook-ingestion";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  service = process.env.SUPABASE_SERVICE_ROLE_KEY;
describe.runIf(Boolean(url && anon && service))(
  "Meta connection routing and webhook isolation",
  () => {
    const suffix = randomUUID().slice(0, 8),
      password = "Correct-Horse-42!";
    let admin: SupabaseClient, a: SupabaseClient, b: SupabaseClient, wa: string, wb: string;
    const users: string[] = [];
    beforeAll(async () => {
      admin = createClient(url!, service!, { auth: { persistSession: false } });
      a = createClient(url!, anon!, { auth: { persistSession: false } });
      b = createClient(url!, anon!, { auth: { persistSession: false } });
      for (const [client, label] of [
        [a, "a"],
        [b, "b"]
      ] as const) {
        const result = await client.auth.signUp({
          email: `meta-${label}-${suffix}@example.test`,
          password,
          options: { data: { business_name: `Meta ${label} ${suffix}` } }
        });
        expect(result.error).toBeNull();
        users.push(result.data.user!.id);
      }
      wa = await workspace(a);
      wb = await workspace(b);
      const { error } = await admin.from("meta_connections").insert([
        {
          workspace_id: wa,
          channel: "whatsapp",
          mode: "sandbox",
          status: "active",
          provider_account_id: `phone-a-${suffix}`,
          display_name: "A WhatsApp",
          permissions: ["whatsapp_business_management", "whatsapp_business_messaging"],
          webhook_message_subscribed: true
        },
        {
          workspace_id: wb,
          channel: "instagram",
          mode: "sandbox",
          status: "reauth_required",
          provider_account_id: `ig-b-${suffix}`,
          display_name: "B Instagram",
          permissions: ["instagram_business_basic", "instagram_business_manage_messages"],
          webhook_message_subscribed: true
        }
      ]);
      expect(error).toBeNull();
    });
    afterAll(async () => {
      for (const id of users) await admin.auth.admin.deleteUser(id);
    });
    it("routes by stored provider account, ignores forged workspace and emits once", async () => {
      const repository = new SupabaseMetaWebhookRepository(admin);
      const event = {
        providerEventId: `event-${suffix}`,
        providerAccountId: `phone-a-${suffix}`,
        channel: "whatsapp" as const,
        type: "message" as const,
        senderRef: "synthetic-sender",
        text: "Synthetic inbound",
        attachments: [],
        occurredAt: "2026-01-01T00:00:00.000Z"
      };
      const first = await repository.ingest(event),
        duplicate = await repository.ingest({ ...event, workspace_id: wb } as typeof event);
      expect(first).toMatchObject({ result: "accepted", trustedWorkspaceId: wa });
      expect(duplicate.result).toBe("duplicate");
      expect(
        (
          await admin
            .from("provider_event_outbox")
            .select("*")
            .eq("webhook_event_id", first.webhookEventId!)
        ).data
      ).toHaveLength(1);
      expect(
        (await a.from("meta_webhook_events").select("workspace_id,provider_event_id")).data
      ).toEqual([{ workspace_id: wa, provider_event_id: `event-${suffix}` }]);
      expect((await b.from("meta_webhook_events").select("*")).data).toEqual([]);
    });
    it("rejects unknown, disabled/reauth connections and browser token access", async () => {
      const repository = new SupabaseMetaWebhookRepository(admin);
      const base = {
        providerEventId: `blocked-${suffix}`,
        channel: "instagram" as const,
        type: "message" as const,
        attachments: [],
        occurredAt: "2026-01-01T00:00:00.000Z"
      };
      expect(
        (await repository.ingest({ ...base, providerAccountId: "unknown-account" })).result
      ).toBe("unknown_connection");
      await admin
        .from("meta_connections")
        .update({ status: "disabled" })
        .eq("provider_account_id", `ig-b-${suffix}`);
      expect(
        (await repository.ingest({ ...base, providerAccountId: `ig-b-${suffix}` })).result
      ).toBe("disabled");
      await admin
        .from("meta_connections")
        .update({ status: "reauth_required" })
        .eq("provider_account_id", `ig-b-${suffix}`);
      expect(
        (await repository.ingest({ ...base, providerAccountId: `ig-b-${suffix}` })).result
      ).toBe("reauth_required");
      expect((await a.from("meta_connections").select("token_ciphertext")).error).not.toBeNull();
      expect((await a.from("meta_connections").select("channel,status")).data).toEqual([
        { channel: "whatsapp", status: "active" }
      ]);
      expect((await b.from("meta_connections").select("channel,status")).data).toEqual([
        { channel: "instagram", status: "reauth_required" }
      ]);
    });
    it("consumes a server-only OAuth state hash exactly once", async () => {
      const stateHash = "a".repeat(64);
      const { error } = await admin.from("meta_oauth_nonces").insert({
        workspace_id: wa,
        channel: "whatsapp",
        state_hash: stateHash,
        expires_at: new Date(Date.now() + 60_000).toISOString()
      });
      expect(error).toBeNull();
      const input = {
        p_workspace_id: wa,
        p_channel: "whatsapp",
        p_state_hash: stateHash
      };
      const first = await admin.rpc("consume_meta_oauth_nonce", input);
      const replay = await admin.rpc("consume_meta_oauth_nonce", input);
      expect(first).toMatchObject({ data: true, error: null });
      expect(replay).toMatchObject({ data: false, error: null });
      const rotatedHash = "b".repeat(64);
      const rotated = await admin.from("meta_oauth_nonces").upsert(
        {
          workspace_id: wa,
          channel: "whatsapp",
          state_hash: rotatedHash,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          consumed_at: null
        },
        { onConflict: "workspace_id,channel" }
      );
      expect(rotated.error).toBeNull();
      expect((await admin.rpc("consume_meta_oauth_nonce", input)).data).toBe(false);
      expect(
        (
          await admin.rpc("consume_meta_oauth_nonce", {
            ...input,
            p_state_hash: rotatedHash
          })
        ).data
      ).toBe(true);
      expect((await a.from("meta_oauth_nonces").select("*")).error).not.toBeNull();
    });
  }
);
async function workspace(client: SupabaseClient) {
  let result = await client.rpc("resolve_workspace", { workspace_hint: null });
  if (result.error?.code === "PGRST303") {
    await new Promise((resolve) => setTimeout(resolve, 1100));
    result = await client.rpc("resolve_workspace", { workspace_hint: null });
  }
  expect(result.error).toBeNull();
  return (result.data as { workspace_id: string }[])[0]!.workspace_id;
}
