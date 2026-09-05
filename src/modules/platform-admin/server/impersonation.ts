import "server-only";

import { IMPERSONATION_MAX_MINUTES, type ImpersonationGrant } from "../contracts";
import { recordPlatformAudit } from "./audit";
import { requireLongReason } from "./reason";
import { assertPlatformCapability, type PlatformAdminRuntime } from "./runtime";

type GrantRow = Readonly<{
  id: string;
  admin_id: string;
  workspace_id: string;
  reason: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  workspaces: { name: string } | { name: string }[] | null;
}>;

function toGrant(row: GrantRow): ImpersonationGrant {
  const workspace = Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces;
  return {
    id: row.id,
    adminId: row.admin_id,
    workspaceId: row.workspace_id,
    workspaceName: workspace?.name ?? "—",
    reason: row.reason,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at
  };
}

const GRANT_COLUMNS = "id,admin_id,workspace_id,reason,expires_at,revoked_at,created_at";

/**
 * Open a read-only "view as" window.
 *
 * A grant mints no session and changes nobody's `auth.uid()`. It records that a
 * named person is about to read a named workspace, for a stated reason, until a
 * stated instant — and the console's workspace reads check for a live grant
 * before showing tenant data behind a banner. Because no write path anywhere
 * consults a grant, "read-only" is a property of the code's shape rather than a
 * rule somebody has to keep remembering.
 */
export async function openImpersonation(
  runtime: PlatformAdminRuntime,
  input: Readonly<{ workspaceId: string; reason: string; minutes: number }>
): Promise<ImpersonationGrant> {
  assertPlatformCapability(runtime.admin, "impersonate");
  const reason = requireLongReason(
    input.reason,
    "Viewing a customer workspace needs a reason of at least 8 characters."
  );
  if (
    !Number.isInteger(input.minutes) ||
    input.minutes < 1 ||
    input.minutes > IMPERSONATION_MAX_MINUTES
  ) {
    throw new Error(`A viewing window must be 1 to ${IMPERSONATION_MAX_MINUTES} minutes.`);
  }

  // One live grant per admin per workspace. Re-opening while one is running
  // would otherwise stack windows whose expiries nobody tracks.
  await revokeLiveGrantsFor(runtime, input.workspaceId, { silent: true });

  const expiresAt = new Date(Date.now() + input.minutes * 60_000).toISOString();
  const { data, error } = await runtime.db
    .from("platform_impersonation_grants")
    .insert({
      admin_id: runtime.admin.userId,
      workspace_id: input.workspaceId,
      reason,
      expires_at: expiresAt
    })
    .select(GRANT_COLUMNS)
    .single();
  if (error || !data) throw new Error("Viewing grant could not be opened.");

  await recordPlatformAudit(runtime, {
    action: "impersonation.opened",
    targetWorkspaceId: input.workspaceId,
    safeDetails: { reason, minutes: input.minutes, expires_at: expiresAt }
  });
  return toGrant({ ...(data as Omit<GrantRow, "workspaces">), workspaces: null });
}

async function revokeLiveGrantsFor(
  runtime: PlatformAdminRuntime,
  workspaceId: string,
  options: Readonly<{ silent?: boolean }> = {}
) {
  const now = new Date().toISOString();
  const { data } = await runtime.db
    .from("platform_impersonation_grants")
    .update({ revoked_at: now })
    .eq("admin_id", runtime.admin.userId)
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
    .gt("expires_at", now)
    .select("id");
  if (!options.silent && (data?.length ?? 0) > 0) {
    await recordPlatformAudit(runtime, {
      action: "impersonation.closed",
      targetWorkspaceId: workspaceId,
      safeDetails: { revoked: data?.length ?? 0 }
    });
  }
  return data?.length ?? 0;
}

export async function closeImpersonation(runtime: PlatformAdminRuntime, workspaceId: string) {
  assertPlatformCapability(runtime.admin, "impersonate");
  return revokeLiveGrantsFor(runtime, workspaceId);
}

/**
 * The grant this admin currently holds on a workspace, if any.
 *
 * Expiry is applied in the query rather than by a sweep, so a window closes on
 * its own the instant it lapses even if no cleanup job ever runs.
 */
export async function activeGrantFor(
  runtime: PlatformAdminRuntime,
  workspaceId: string
): Promise<ImpersonationGrant | null> {
  const now = new Date().toISOString();
  const { data } = await runtime.db
    .from("platform_impersonation_grants")
    .select(`${GRANT_COLUMNS},workspaces(name)`)
    .eq("admin_id", runtime.admin.userId)
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
    .gt("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0] as GrantRow | undefined;
  return row ? toGrant(row) : null;
}

/** Every live grant, by anybody. The overview counts these. */
export async function listActiveImpersonations(
  runtime: PlatformAdminRuntime
): Promise<readonly ImpersonationGrant[]> {
  const now = new Date().toISOString();
  const { data } = await runtime.db
    .from("platform_impersonation_grants")
    .select(`${GRANT_COLUMNS},workspaces(name)`)
    .is("revoked_at", null)
    .gt("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(100);
  return ((data ?? []) as GrantRow[]).map(toGrant);
}

export async function listRecentImpersonations(
  runtime: PlatformAdminRuntime,
  limit = 50
): Promise<readonly ImpersonationGrant[]> {
  const { data } = await runtime.db
    .from("platform_impersonation_grants")
    .select(`${GRANT_COLUMNS},workspaces(name)`)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  return ((data ?? []) as GrantRow[]).map(toGrant);
}
