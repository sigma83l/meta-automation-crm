import "server-only";

import type { PlatformAuditRow } from "../contracts";
import type { PlatformAdminRuntime } from "./runtime";

/**
 * Values allowed into `safe_details`.
 *
 * Narrow on purpose. The column is the one place a well-meaning caller could
 * spread a whole row into the ledger and quietly persist a customer's contact
 * details or a provider token, so the type refuses anything that could carry a
 * nested payload and `sanitise` truncates what is left.
 */
export type SafeDetailValue = string | number | boolean | null;

const MAX_DETAIL_LENGTH = 400;

function sanitise(details: Readonly<Record<string, SafeDetailValue>>) {
  const safe: Record<string, SafeDetailValue> = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
      continue;
    }
    safe[key] = value.length > MAX_DETAIL_LENGTH ? `${value.slice(0, MAX_DETAIL_LENGTH)}…` : value;
  }
  return safe;
}

/**
 * Writes one line to the append-only ledger.
 *
 * Every console mutation calls this, and the call sits *after* the mutation
 * rather than before: a ledger line for an action that then failed is a worse
 * lie than a missing line for one that succeeded, because the first is read as
 * evidence and the second is visible as a gap next to the changed state.
 */
export async function recordPlatformAudit(
  runtime: PlatformAdminRuntime,
  entry: Readonly<{
    action: string;
    targetWorkspaceId?: string | null;
    targetUserId?: string | null;
    safeDetails?: Readonly<Record<string, SafeDetailValue>>;
  }>
) {
  const { error } = await runtime.db.from("platform_admin_audit_events").insert({
    actor_id: runtime.admin.userId,
    actor_role: runtime.admin.role,
    action: entry.action,
    target_workspace_id: entry.targetWorkspaceId ?? null,
    target_user_id: entry.targetUserId ?? null,
    safe_details: sanitise(entry.safeDetails ?? {})
  });
  if (error) throw new Error(`Platform audit write failed: ${error.code ?? "unknown"}`);
}

/**
 * How long one recorded view stands for before another is written.
 *
 * Without this every refresh, every back button and every action's
 * `router.refresh()` would add a line, and a ledger somebody has to page
 * through to find the four lines that matter is a ledger nobody reads. Fifteen
 * minutes collapses one sitting into one line while still separating two
 * visits.
 */
const VIEW_LEDGER_WINDOW_MS = 15 * 60_000;

/**
 * Records that a staff member read a customer's workspace.
 *
 * The ledger recorded every mutation and no reads at all, so the question it
 * could not answer was the one an affected customer actually asks: who looked
 * at my data? Impersonation grants seemed to answer it and did not — they gate
 * nothing, so opening one is voluntary, and a staff member who never opens one
 * left no trace anywhere.
 *
 * **Fails closed.** If the line cannot be written the read does not happen,
 * which is the same bargain the rest of this module makes: cross-tenant power
 * is only defensible while it is accountable, and a console that keeps serving
 * customer data after its ledger has stopped accepting entries is exactly the
 * state the ledger exists to prevent. The blast radius is one screen — the
 * overview, the queues and the switches carry no tenant data and are unaffected.
 */
export async function recordWorkspaceView(
  runtime: PlatformAdminRuntime,
  workspaceId: string
): Promise<void> {
  const since = new Date(Date.now() - VIEW_LEDGER_WINDOW_MS).toISOString();
  const { data, error: readError } = await runtime.db
    .from("platform_admin_audit_events")
    .select("id")
    .eq("actor_id", runtime.admin.userId)
    .eq("action", "workspace.viewed")
    .eq("target_workspace_id", workspaceId)
    .gte("occurred_at", since)
    .limit(1);
  // A failed read is not a licence to skip the write. Falling through records a
  // line that may duplicate a recent one, which costs a row; the alternative
  // costs the record.
  if (!readError && (data ?? []).length > 0) return;

  await recordPlatformAudit(runtime, {
    action: "workspace.viewed",
    targetWorkspaceId: workspaceId
  });
}

export async function listPlatformAudit(
  runtime: PlatformAdminRuntime,
  options: Readonly<{ workspaceId?: string; actorId?: string; limit?: number }> = {}
): Promise<readonly PlatformAuditRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  let query = runtime.db
    .from("platform_admin_audit_events")
    .select(
      "id,actor_id,actor_role,action,target_workspace_id,target_user_id,safe_details,occurred_at"
    )
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (options.workspaceId) query = query.eq("target_workspace_id", options.workspaceId);
  if (options.actorId) query = query.eq("actor_id", options.actorId);
  const { data, error } = await query;
  if (error) throw new Error("Platform audit read failed.");
  return (data ?? []).map((row) => ({
    id: Number(row.id),
    actorId: row.actor_id,
    actorRole: row.actor_role,
    action: row.action,
    targetWorkspaceId: row.target_workspace_id,
    targetUserId: row.target_user_id,
    safeDetails: (row.safe_details ?? {}) as Record<string, unknown>,
    occurredAt: row.occurred_at
  }));
}
