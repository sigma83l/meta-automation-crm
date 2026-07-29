import "server-only";

import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { inngest } from "./client";

export const relayMetaOutbox = inngest.createFunction(
  {
    id: "relay-meta-event-outbox",
    retries: 5,
    concurrency: { limit: 1 },
    triggers: { cron: "* * * * *" }
  },
  async ({ step }) => {
    const rows = await step.run("claim-pending-outbox", async () => {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin
        .from("provider_event_outbox")
        .select("id,workspace_id,payload,attempts")
        .is("emitted_at", null)
        .lt("attempts", 10)
        .order("created_at")
        .limit(100);
      if (error) throw new Error("OUTBOX_READ_FAILED");
      return data ?? [];
    });

    for (const row of rows) {
      await step.run(`emit-${row.id}`, async () => {
        const payload = row.payload as Record<string, unknown>;
        await inngest.send({
          id: String(payload.webhookEventId ?? row.id),
          name: "meta/webhook.received",
          data: payload
        });
        const admin = createSupabaseAdminClient();
        const { error } = await admin
          .from("provider_event_outbox")
          .update({
            emitted_at: new Date().toISOString(),
            attempts: Number(row.attempts) + 1
          })
          .eq("id", row.id)
          .eq("workspace_id", row.workspace_id)
          .is("emitted_at", null);
        if (error) throw new Error("OUTBOX_MARK_FAILED");
      });
    }
    return { emitted: rows.length };
  }
);

export const processVerifiedMetaEvent = inngest.createFunction(
  {
    id: "process-verified-meta-event",
    retries: 5,
    concurrency: [{ limit: 4, key: "event.data.trustedWorkspaceId" }],
    triggers: { event: "meta/webhook.received" }
  },
  async ({ event, step }) =>
    step.run("verify-trusted-routing-record", async () => {
      const data = event.data as Record<string, unknown>;
      const webhookEventId = String(data.webhookEventId ?? "");
      const trustedWorkspaceId = String(data.trustedWorkspaceId ?? "");
      const admin = createSupabaseAdminClient();
      const { data: row, error } = await admin
        .from("meta_webhook_events")
        .select("id,workspace_id,processing_status")
        .eq("id", webhookEventId)
        .eq("workspace_id", trustedWorkspaceId)
        .single();
      if (error || !row) throw new Error("TRUSTED_WEBHOOK_ROUTE_NOT_FOUND");
      const updated = await admin
        .from("meta_webhook_events")
        .update({ processing_status: "processed" })
        .eq("id", webhookEventId)
        .eq("workspace_id", trustedWorkspaceId)
        .eq("processing_status", "accepted");
      if (updated.error) throw new Error("WEBHOOK_PROCESSING_MARK_FAILED");
      return { webhookEventId, trustedWorkspaceId };
    })
);

export const cleanupExpiredPrivateArtifacts = inngest.createFunction(
  {
    id: "cleanup-expired-private-artifacts",
    retries: 3,
    concurrency: { limit: 1 },
    triggers: { cron: "17 3 * * *" }
  },
  async ({ step }) => {
    const removedRateLimits = await step.run("purge-rate-limits", async () => {
      const { data, error } = await createSupabaseAdminClient().rpc(
        "purge_expired_auth_rate_limits",
        { requested_limit: 10_000 }
      );
      if (error) throw new Error("RATE_LIMIT_CLEANUP_FAILED");
      return Number(data ?? 0);
    });
    const expiredExports = await step.run("expire-private-exports", async () => {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin
        .from("export_jobs")
        .select("id,workspace_id,object_path")
        .in("status", ["ready", "failed"])
        .lte("expires_at", new Date().toISOString())
        .limit(250);
      if (error) throw new Error("EXPORT_CLEANUP_READ_FAILED");
      let removed = 0;
      for (const job of data ?? []) {
        if (job.object_path) {
          const storage = await admin.storage.from("crm-private").remove([job.object_path]);
          if (storage.error) throw new Error("EXPORT_OBJECT_CLEANUP_FAILED");
        }
        const update = await admin
          .from("export_jobs")
          .update({ status: "expired", object_path: null })
          .eq("id", job.id)
          .eq("workspace_id", job.workspace_id);
        if (update.error) throw new Error("EXPORT_CLEANUP_MARK_FAILED");
        removed += 1;
      }
      return removed;
    });
    return { removedRateLimits, expiredExports };
  }
);

export const inngestFunctions = [
  relayMetaOutbox,
  processVerifiedMetaEvent,
  cleanupExpiredPrivateArtifacts
] as const;
