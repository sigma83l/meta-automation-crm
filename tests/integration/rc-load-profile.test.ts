import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SendIdempotencyLedger } from "@/src/modules/automations/durable";
import { buildCrmExport } from "@/src/modules/exports/export-builder";
import { SupabaseMetaWebhookRepository } from "@/src/modules/integrations/meta/webhook-ingestion";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.runIf(Boolean(url && service))("RC synthetic load and concurrency profile", () => {
  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const workspaces: string[] = [];
  let admin: SupabaseClient;

  beforeAll(async () => {
    admin = createClient(url!, service!, { auth: { persistSession: false } });
    for (let index = 0; index < 20; index++) {
      const created = await admin.auth.admin.createUser({
        email: `rc-load-${index}-${suffix}@example.test`,
        password: "Correct-Horse-42!",
        email_confirm: true,
        user_metadata: { business_name: `RC Workspace ${index} ${suffix}` }
      });
      expect(created.error).toBeNull();
      userIds.push(created.data.user!.id);
      const membership = await admin
        .from("workspace_memberships")
        .select("workspace_id")
        .eq("user_id", created.data.user!.id)
        .single();
      expect(membership.error).toBeNull();
      workspaces.push(membership.data!.workspace_id);
    }
    const { error } = await admin.from("meta_connections").insert(
      workspaces.map((workspaceId, index) => ({
        workspace_id: workspaceId,
        channel: "whatsapp",
        mode: "sandbox",
        status: "active",
        provider_account_id: `rc-phone-${index}-${suffix}`,
        display_name: `RC WhatsApp ${index}`,
        permissions: ["whatsapp_business_management", "whatsapp_business_messaging"],
        webhook_message_subscribed: true
      }))
    );
    expect(error).toBeNull();
  }, 60_000);

  afterAll(async () => {
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("isolates 20 workspaces under duplicate retries, provider delay and bounded concurrency", async () => {
    const repository = new SupabaseMetaWebhookRepository(admin);
    const activeByWorkspace = new Map<string, number>();
    let activeGlobal = 0;
    let maxGlobal = 0;
    let maxWorkspace = 0;
    const results: string[] = [];

    for (let eventIndex = 0; eventIndex < 10; eventIndex++) {
      const round = workspaces.flatMap((workspaceId, workspaceIndex) =>
        [0, 1].map(() => async () => {
          activeGlobal += 1;
          const workspaceActive = (activeByWorkspace.get(workspaceId) ?? 0) + 1;
          activeByWorkspace.set(workspaceId, workspaceActive);
          maxGlobal = Math.max(maxGlobal, activeGlobal);
          maxWorkspace = Math.max(maxWorkspace, workspaceActive);
          try {
            await new Promise((resolve) => setTimeout(resolve, 5));
            const result = await repository.ingest({
              providerEventId: `rc-event-${workspaceIndex}-${eventIndex}-${suffix}`,
              providerAccountId: `rc-phone-${workspaceIndex}-${suffix}`,
              channel: "whatsapp",
              type: "message",
              senderRef: `synthetic-sender-${workspaceIndex}`,
              text: "Synthetic RC load message",
              attachments: [],
              occurredAt: "2026-07-29T10:00:00.000Z"
            });
            results.push(result.result);
          } finally {
            activeGlobal -= 1;
            activeByWorkspace.set(workspaceId, (activeByWorkspace.get(workspaceId) ?? 1) - 1);
          }
        })
      );
      await runBounded(round, 8);
    }

    expect(results.filter((result) => result === "accepted")).toHaveLength(200);
    expect(results.filter((result) => result === "duplicate")).toHaveLength(200);
    expect(maxGlobal).toBe(8);
    expect(maxWorkspace).toBe(2);

    const events = await admin
      .from("meta_webhook_events")
      .select("workspace_id,provider_event_id")
      .like("provider_event_id", `rc-event-%-${suffix}`);
    expect(events.error).toBeNull();
    expect(events.data).toHaveLength(200);
    for (const [workspaceIndex, workspaceId] of workspaces.entries()) {
      const owned = events.data!.filter((row) => row.workspace_id === workspaceId);
      expect(owned).toHaveLength(10);
      expect(
        owned.every((row) => row.provider_event_id.startsWith(`rc-event-${workspaceIndex}-`))
      ).toBe(true);
    }
    const outbox = await admin
      .from("provider_event_outbox")
      .select("workspace_id")
      .in("workspace_id", workspaces);
    expect(outbox.error).toBeNull();
    expect(outbox.data).toHaveLength(200);
  }, 60_000);

  it("keeps export and outbound idempotency work workspace-scoped", async () => {
    const exports = await runBounded(
      workspaces.map(
        (workspaceId) => async () =>
          buildCrmExport({
            workspaceId,
            generatedAt: "2026-07-29T10:00:00.000Z",
            sheets: { Customers: [{ id: randomUUID(), display_name: "Synthetic Customer" }] },
            attachments: []
          })
      ),
      4
    );
    expect(exports).toHaveLength(20);
    expect(new Set(exports.map((artifact) => artifact.manifest.workspaceId))).toEqual(
      new Set(workspaces)
    );

    for (const workspaceId of workspaces) {
      const ledger = new SendIdempotencyLedger();
      const key = `${workspaceId}:outbound:1`;
      expect(ledger.reserve(key)).toBe(true);
      expect(ledger.reserve(key)).toBe(false);
      expect(ledger.sent(key)).toBe(true);
      expect(ledger.canRetry(key)).toBe(false);
    }
  }, 60_000);
});

async function runBounded<T>(tasks: readonly (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (cursor < tasks.length) {
        const index = cursor++;
        const task = tasks[index]!;
        results[index] = await task();
      }
    })
  );
  return results;
}
