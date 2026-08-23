import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormalizedMetaEvent } from "./contracts";
import type { IngestionResult } from "./webhook-ingestion";

/**
 * Sends accepted events on immediately, instead of waiting for the relay.
 *
 * The outbox exists so that an event which is stored cannot be lost, and that
 * is worth keeping. What is not worth keeping is a cron polling it every
 * minute: at a realistic small-business volume the polling costs several times
 * what processing the actual messages costs, and it adds up to a minute of
 * latency to every reply for the privilege.
 *
 * So the row is still written, and the relay still exists - it just becomes
 * the safety net it was always described as rather than the primary path.
 *
 * Two properties make this safe to do twice:
 *
 *   - `inngest.send` deduplicates on the event id, and both paths use the
 *     webhook event id. A relay that re-sends something already sent directly
 *     produces one execution, not two.
 *   - Marking the row emitted is an ordinary update. If it fails after a
 *     successful send, the relay will send again, and the deduplication above
 *     absorbs it. The failure mode is a wasted send, never a duplicate turn.
 *
 * Failure here is deliberately not propagated. The customer's message is
 * already durably stored by the time this runs, so a send that does not happen
 * is a delayed reply, not a lost one - and turning it into a 5xx would make
 * Meta redeliver a message we have already accepted.
 */

export type DispatchOutcome = Readonly<{ sent: number; deferred: number }>;

/** The event shape the processor expects, identical to the relay's payload. */
export type MetaWebhookEvent = Readonly<{
  id: string;
  name: "meta/webhook.received";
  data: Readonly<{
    webhookEventId: string;
    trustedWorkspaceId: string;
    channel: string;
    providerEventId: string;
  }>;
}>;

export async function dispatchAcceptedEvents(
  admin: SupabaseClient,
  events: readonly NormalizedMetaEvent[],
  results: readonly IngestionResult[],
  send: (event: MetaWebhookEvent) => Promise<unknown>
): Promise<DispatchOutcome> {
  let sent = 0;
  let deferred = 0;

  // Sequential, in ingest order: per-conversation ordering is a property the
  // ingest loop already preserves, and dispatching concurrently would discard
  // it for no gain at these volumes.
  for (const [index, result] of results.entries()) {
    if (result.result !== "accepted") continue;
    const event = events[index];
    const { webhookEventId, trustedWorkspaceId } = result;
    if (!event || !webhookEventId || !trustedWorkspaceId) {
      deferred += 1;
      continue;
    }

    try {
      await send({
        id: webhookEventId,
        name: "meta/webhook.received",
        data: {
          webhookEventId,
          trustedWorkspaceId,
          channel: event.channel,
          providerEventId: event.providerEventId
        }
      });
    } catch {
      // The relay will find this row still unemitted and try again.
      deferred += 1;
      continue;
    }

    // Marked after the send, never before: a row marked emitted for a send that
    // did not happen is the one ordering that loses a message, because the
    // relay would then skip it forever.
    //
    // A failure to mark is not checked, and that is deliberate. The send
    // already succeeded, so the relay finding this row again costs one
    // redundant send that Inngest deduplicates - which is strictly better than
    // treating a delivered event as undelivered.
    await admin
      .from("provider_event_outbox")
      .update({ emitted_at: new Date().toISOString() })
      .eq("webhook_event_id", webhookEventId)
      .eq("workspace_id", trustedWorkspaceId)
      .is("emitted_at", null);
    sent += 1;
  }

  return Object.freeze({ sent, deferred });
}
