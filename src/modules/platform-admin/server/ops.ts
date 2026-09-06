import "server-only";

import { attemptsAfterManualRetry, OUTBOX_ATTEMPT_CEILING } from "@/src/lib/inngest/outbox-policy";

import type { DeadLetterRow, OutboxHealth, StuckOutboxRow } from "../contracts";
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
 * Clearing `emitted_at` is most of it: the five-minute cron claims unemitted
 * rows and sends each one with a deterministic event id, so a row that was in
 * fact delivered is deduplicated downstream rather than delivered twice.
 *
 * It is not all of it, which is what this used to get wrong. The relay claims
 * only rows below `OUTBOX_ATTEMPT_CEILING`, so clearing `emitted_at` on a row
 * that had already exhausted its tries moved nothing — and those were the only
 * rows the console flagged as needing a person. The action reported success and
 * wrote a ledger line asserting a requeue that had not happened.
 *
 * So the counter moves too, downwards, by a bounded amount:
 * `attemptsAfterManualRetry` grants a few fresh tries and never more, and never
 * raises a row's counter either. The original reasoning holds — resetting to
 * zero would let a permanently failing row loop forever — and this keeps it
 * while still making the button do something. What is left is a decision a
 * person made, recorded with the count it was made against.
 */
export async function requeueOutboxEvent(
  runtime: PlatformAdminRuntime,
  input: Readonly<{ id: string; reason: string }>
) {
  assertPlatformCapability(runtime.admin, "operations");
  const reason = requireReason(input.reason);

  const { data: current } = await runtime.db
    .from("provider_event_outbox")
    .select("id,workspace_id,attempts")
    .eq("id", input.id)
    .maybeSingle();
  if (!current) throw new Error("Unknown outbox event.");

  const attemptsWas = Number(current.attempts ?? 0);
  const { data, error } = await runtime.db
    .from("provider_event_outbox")
    .update({ emitted_at: null, attempts: attemptsAfterManualRetry(attemptsWas) })
    .eq("id", input.id)
    .select("id,workspace_id,attempts");
  if (error) throw new Error("Outbox requeue failed.");
  const row = (data ?? [])[0];
  if (!row) throw new Error("Unknown outbox event.");

  await recordPlatformAudit(runtime, {
    action: "ops.outbox_requeued",
    targetWorkspaceId: String(row.workspace_id),
    safeDetails: {
      outbox_id: input.id,
      // Both numbers: "requeued a row that had failed twelve times" and
      // "requeued a row that had failed once" are different decisions, and the
      // ledger should not flatten them into the value they now share.
      attempts_was: attemptsWas,
      attempts: Number(row.attempts),
      reason
    }
  });
}

/**
 * The rows the relay has given up on, as rows rather than as a number.
 *
 * The panel counted these and said they "need a person", then offered that
 * person nothing to press — the requeue endpoint existed but reached no screen,
 * so acting on one meant hand-writing a POST. A count of work nobody can act on
 * is a worse panel than no count at all.
 */
export async function listStuckOutboxEvents(
  runtime: PlatformAdminRuntime,
  options: Readonly<{ limit?: number }> = {}
): Promise<readonly StuckOutboxRow[]> {
  const { data, error } = await runtime.db
    .from("provider_event_outbox")
    .select("id,workspace_id,attempts,created_at")
    .is("emitted_at", null)
    .gte("attempts", OUTBOX_ATTEMPT_CEILING)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(options.limit ?? 50, 1), 200));
  if (error) throw new Error("Outbox read failed.");

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
    attempts: Number(row.attempts ?? 0),
    createdAt: String(row.created_at)
  }));
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
      .gte("attempts", OUTBOX_ATTEMPT_CEILING),
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
