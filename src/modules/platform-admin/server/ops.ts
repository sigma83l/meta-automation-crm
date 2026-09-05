import "server-only";

import type { DeadLetterRow, OutboxHealth } from "../contracts";
import { recordPlatformAudit } from "./audit";
import { requireReason } from "./reason";
import { assertPlatformCapability, type PlatformAdminRuntime } from "./runtime";

export async function listDeadLetters(
  runtime: PlatformAdminRuntime,
  options: Readonly<{ workspaceId?: string; limit?: number }> = {}
): Promise<readonly DeadLetterRow[]> {
  let query = runtime.db
    .from("automation_dead_letters")
    .select("id,workspace_id,run_id,error_code,safe_summary,recoverable,created_at")
    .is("recovered_at", null)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(options.limit ?? 50, 1), 200));
  if (options.workspaceId) query = query.eq("workspace_id", options.workspaceId);
  const { data, error } = await query;
  if (error) throw new Error("Dead letter read failed.");

  const rows = data ?? [];
  const workspaceIds = [...new Set(rows.map((row) => String(row.workspace_id)))];
  const { data: workspaces } = workspaceIds.length
    ? await runtime.db.from("workspaces").select("id,name").in("id", workspaceIds)
    : { data: [] };
  const nameById = new Map((workspaces ?? []).map((row) => [String(row.id), String(row.name)]));

  return rows.map((row) => ({
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    workspaceName: nameById.get(String(row.workspace_id)) ?? "—",
    runId: String(row.run_id),
    errorCode: String(row.error_code),
    safeSummary: String(row.safe_summary),
    recoverable: Boolean(row.recoverable),
    createdAt: String(row.created_at)
  }));
}

/**
 * Mark a dead letter handled.
 *
 * Acknowledgement, not replay. Nothing here re-runs an automation step: a
 * failed run may already have produced a provider send whose persistence is
 * unknown, and `AGENTS.md` is explicit that such a send is `sent_unknown` and
 * never blindly retried. So the console can clear the queue and record who
 * cleared it, and re-running the work stays a decision made in the automation
 * itself, with the run's own idempotency keys in play.
 */
export async function acknowledgeDeadLetter(
  runtime: PlatformAdminRuntime,
  input: Readonly<{ id: string; reason: string }>
) {
  assertPlatformCapability(runtime.admin, "operations");
  const reason = requireReason(input.reason);
  const { data, error } = await runtime.db
    .from("automation_dead_letters")
    .update({ recovered_at: new Date().toISOString() })
    .eq("id", input.id)
    .is("recovered_at", null)
    .select("id,workspace_id,error_code");
  if (error) throw new Error("Dead letter acknowledgement failed.");
  const row = (data ?? [])[0];
  if (!row) throw new Error("That dead letter is already cleared.");

  await recordPlatformAudit(runtime, {
    action: "ops.dead_letter_acknowledged",
    targetWorkspaceId: String(row.workspace_id),
    safeDetails: { dead_letter_id: input.id, error_code: String(row.error_code), reason }
  });
}

/**
 * Put an outbox row back in front of the relay.
 *
 * Clearing `emitted_at` is all it takes: the five-minute cron claims unemitted
 * rows and sends each one with a deterministic event id, so a row that was in
 * fact delivered is deduplicated downstream rather than delivered twice. The
 * attempt counter is left alone deliberately — it is the reason the relay gives
 * up after ten tries, and resetting it here would make a permanently failing
 * row loop forever.
 */
export async function requeueOutboxEvent(
  runtime: PlatformAdminRuntime,
  input: Readonly<{ id: string; reason: string }>
) {
  assertPlatformCapability(runtime.admin, "operations");
  const reason = requireReason(input.reason);
  const { data, error } = await runtime.db
    .from("provider_event_outbox")
    .update({ emitted_at: null })
    .eq("id", input.id)
    .select("id,workspace_id,attempts");
  if (error) throw new Error("Outbox requeue failed.");
  const row = (data ?? [])[0];
  if (!row) throw new Error("Unknown outbox event.");

  await recordPlatformAudit(runtime, {
    action: "ops.outbox_requeued",
    targetWorkspaceId: String(row.workspace_id),
    safeDetails: { outbox_id: input.id, attempts: Number(row.attempts), reason }
  });
}

export async function loadOutboxHealth(runtime: PlatformAdminRuntime): Promise<OutboxHealth> {
  const [pending, exhausted, webhooks] = await Promise.all([
    runtime.db
      .from("provider_event_outbox")
      .select("*", { count: "exact", head: true })
      .is("emitted_at", null),
    runtime.db
      .from("provider_event_outbox")
      .select("*", { count: "exact", head: true })
      .is("emitted_at", null)
      .gte("attempts", 10),
    runtime.db
      .from("meta_webhook_events")
      .select("*", { count: "exact", head: true })
      .eq("processing_status", "accepted")
  ]);
  return {
    pendingOutbox: pending.count ?? 0,
    // Past the relay's attempt ceiling: these will never be picked up again
    // without somebody looking at them, which is the point of showing them.
    exhaustedOutbox: exhausted.count ?? 0,
    unprocessedWebhooks: webhooks.count ?? 0
  };
}
