import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  service = process.env.SUPABASE_SERVICE_ROLE_KEY;
describe.runIf(Boolean(url && anon && service))(
  "business knowledge and AI credential isolation",
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
          email: `ai-${label}-${suffix}@example.test`,
          password,
          options: { data: { business_name: `AI ${label} ${suffix}` } }
        });
        expect(result.error).toBeNull();
        users.push(result.data.user!.id);
      }
      wa = await workspace(a);
      wb = await workspace(b);
    });
    afterAll(async () => {
      for (const id of users) await admin.auth.admin.deleteUser(id);
    });
    it("creates one default profile and isolates structured knowledge", async () => {
      expect((await a.from("business_profiles").select("*")).data).toHaveLength(1);
      await a.from("business_faq_items").insert({
        workspace_id: wa,
        question: "Synthetic hours?",
        answer: "09:00–17:00",
        language: "en"
      });
      await b.from("business_price_items").insert({
        workspace_id: wb,
        name: "Synthetic plan",
        amount_minor: 1000,
        currency: "USD",
        availability: "available"
      });
      expect((await a.from("business_price_items").select("*")).data).toEqual([]);
      expect((await b.from("business_faq_items").select("*")).data).toEqual([]);
      expect(
        (
          await a
            .from("business_faq_items")
            .insert({ workspace_id: wb, question: "Forged", answer: "Denied" })
        ).error
      ).not.toBeNull();
    });
    it("denies browser credential writes and cross-tenant reads", async () => {
      const fake = {
        workspace_id: wa,
        provider: "openai",
        ciphertext: "cipher",
        iv: "iv",
        auth_tag: "tag",
        key_version: 1,
        masked_suffix: "1234"
      };
      expect((await a.from("workspace_ai_credentials").insert(fake)).error).not.toBeNull();
      let inserted = await admin.from("workspace_ai_credentials").insert(fake);
      if (inserted.error?.code === "PGRST303") {
        await new Promise((resolve) => setTimeout(resolve, 1_100));
        inserted = await admin.from("workspace_ai_credentials").insert(fake);
      }
      expect(inserted.error).toBeNull();
      expect(
        (
          await b
            .from("workspace_ai_credentials")
            .select("provider,masked_suffix")
            .eq("workspace_id", wa)
        ).data
      ).toEqual([]);
      expect((await a.from("workspace_ai_credentials").select("ciphertext")).error).not.toBeNull();
      expect(
        (await a.from("workspace_ai_credentials").select("provider,masked_suffix")).data
      ).toEqual([{ provider: "openai", masked_suffix: "1234" }]);
    });
  }
);
async function workspace(client: SupabaseClient) {
  let r = await client.rpc("resolve_workspace", { workspace_hint: null });
  if (r.error?.code === "PGRST303") {
    await new Promise((v) => setTimeout(v, 1100));
    r = await client.rpc("resolve_workspace", { workspace_hint: null });
  }
  expect(r.error).toBeNull();
  return (r.data as { workspace_id: string }[])[0]!.workspace_id;
}
