import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeMetaWebhook } from "./normalizer";
import type { NormalizedMetaEvent } from "./contracts";

export type IngestionResult = Readonly<{
  result:
    | "accepted"
    | "duplicate"
    | "unknown_connection"
    | "disabled"
    | "degraded"
    | "policy_blocked"
    | "reauth_required"
    | "disconnected"
    | "pending";
  webhookEventId?: string;
  trustedWorkspaceId?: string;
}>;
export interface MetaWebhookRepository {
  ingest(event: NormalizedMetaEvent): Promise<IngestionResult>;
}
export class SupabaseMetaWebhookRepository implements MetaWebhookRepository {
  constructor(private readonly admin: SupabaseClient) {}
  async ingest(event: NormalizedMetaEvent): Promise<IngestionResult> {
    const { data, error } = await this.admin.rpc("ingest_meta_event", {
      p_channel: event.channel,
      p_provider_account_id: event.providerAccountId,
      p_provider_event_id: event.providerEventId,
      p_event_type: event.type,
      p_sender_ref: event.senderRef ?? null,
      p_provider_message_ref: event.providerMessageRef ?? null,
      p_text_summary: event.text?.slice(0, 500) ?? null,
      // The request body is the only place the whole message ever exists. The
      // projection runs later, from durable state, so anything not stored here
      // is gone by the time a conversation wants it.
      p_body: event.text ?? null,
      p_attachment_metadata: event.attachments,
      p_status_metadata: event.status ? { status: event.status } : {},
      p_occurred_at: event.occurredAt
    });
    if (error) throw new Error("Webhook persistence failed.");
    const row = (
      data as {
        result: IngestionResult["result"];
        webhook_event_id: string | null;
        trusted_workspace_id: string | null;
      }[]
    )[0]!;
    return {
      result: row.result,
      ...(row.webhook_event_id ? { webhookEventId: row.webhook_event_id } : {}),
      ...(row.trusted_workspace_id ? { trustedWorkspaceId: row.trusted_workspace_id } : {})
    };
  }
}
export async function ingestVerifiedMetaPayload(
  payload: unknown,
  repository: MetaWebhookRepository
) {
  const normalized = normalizeMetaWebhook(payload);
  if (!normalized.ok) return { acknowledged: false, status: "invalid_payload" as const };

  // A delivery can carry many events. Each is ingested on its own so that one
  // unroutable item cannot discard the rest, and so the unique constraint on
  // (channel, provider_event_id) deduplicates per event rather than per POST.
  // Sequential on purpose: per-conversation ordering must survive the batch.
  const results: IngestionResult[] = [];
  for (const event of normalized.value) {
    results.push(await repository.ingest(event));
  }

  const firstResult = results[0]!;
  const accepted = results.filter((result) => result.result === "accepted").length;
  return {
    acknowledged: true,
    // Reported for the batch as a whole; per-event outcomes are in `results`.
    status: firstResult.result,
    events: normalized.value,
    results,
    acceptedCount: accepted,
    eventCount: normalized.value.length,
    ...firstResult
  };
}
