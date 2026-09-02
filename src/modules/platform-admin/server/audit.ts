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
