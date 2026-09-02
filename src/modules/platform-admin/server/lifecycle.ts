import "server-only";

import { recordPlatformAudit } from "./audit";
import { assertPlatformCapability, type PlatformAdminRuntime } from "./runtime";

/**
 * Suspension, not deletion.
 *
 * Both states already exist in the schema — `workspaces.status` and
 * `profiles.status` — and both are consulted by `private.is_active_member`,
 * which every workspace-scoped policy is built on. So flipping a status here
 * withdraws access at the engine for every table at once, and restores it the
 * same way. Nothing is removed, which is what makes the action reversible and
 * what keeps it distinct from the deletion path.
 */
export async function setWorkspaceStatus(
  runtime: PlatformAdminRuntime,
  input: Readonly<{ workspaceId: string; status: "active" | "disabled"; reason: string }>
) {
  assertPlatformCapability(runtime.admin, "lifecycle");
  const reason = requireReason(input.reason);
  const { error } = await runtime.db
    .from("workspaces")
    .update({ status: input.status, updated_at: new Date().toISOString() })
    .eq("id", input.workspaceId);
  if (error) throw new Error("Workspace status change failed.");

  await recordPlatformAudit(runtime, {
    action: input.status === "disabled" ? "workspace.suspended" : "workspace.restored",
    targetWorkspaceId: input.workspaceId,
    safeDetails: { status: input.status, reason }
  });
}

export async function setUserStatus(
  runtime: PlatformAdminRuntime,
  input: Readonly<{ userId: string; status: "active" | "disabled"; reason: string }>
) {
  assertPlatformCapability(runtime.admin, "lifecycle");
  const reason = requireReason(input.reason);

  const { data: profile, error: readError } = await runtime.db
    .from("profiles")
    .select("workspace_id")
    .eq("id", input.userId)
    .maybeSingle();
  if (readError || !profile) throw new Error("Account not found.");

  const { error } = await runtime.db
    .from("profiles")
    .update({ status: input.status, updated_at: new Date().toISOString() })
    .eq("id", input.userId);
  if (error) throw new Error("Account status change failed.");

  // A disabled profile stops the next request, but it does not touch the
  // refresh token the browser already holds: without this the account keeps
  // working until that token happens to expire, which is not what "suspend"
  // means to whoever pressed the button.
  if (input.status === "disabled") {
    await runtime.db.auth.admin.signOut(input.userId, "global").catch(() => undefined);
  }

  await recordPlatformAudit(runtime, {
    action: input.status === "disabled" ? "user.suspended" : "user.restored",
    targetWorkspaceId: profile.workspace_id as string,
    targetUserId: input.userId,
    safeDetails: { status: input.status, reason }
  });
}

/**
 * End every session an account holds, without changing its status.
 *
 * The action for a customer who says "I think somebody else is in my account":
 * it costs them one sign-in and costs an attacker their foothold, and it is
 * safe to run when you are not yet sure anything is wrong.
 */
export async function forceSignOut(
  runtime: PlatformAdminRuntime,
  input: Readonly<{ userId: string; reason: string }>
) {
  assertPlatformCapability(runtime.admin, "lifecycle");
  const reason = requireReason(input.reason);
  const { data: profile } = await runtime.db
    .from("profiles")
    .select("workspace_id")
    .eq("id", input.userId)
    .maybeSingle();

  const { error } = await runtime.db.auth.admin.signOut(input.userId, "global");
  if (error) throw new Error("Sessions could not be ended.");

  await recordPlatformAudit(runtime, {
    action: "user.sessions_revoked",
    targetWorkspaceId: (profile?.workspace_id as string | undefined) ?? null,
    targetUserId: input.userId,
    safeDetails: { reason }
  });
}

/**
 * Change what a member may do inside their own workspace.
 *
 * Included because the commonest support request in a multi-seat product is
 * "the only owner left the company". Deliberately refuses to leave a workspace
 * with no owner at all, since that state has no route out except this same
 * screen.
 */
export async function setMembershipRole(
  runtime: PlatformAdminRuntime,
  input: Readonly<{
    workspaceId: string;
    userId: string;
    role: "owner" | "admin" | "operator" | "viewer";
    reason: string;
  }>
) {
  assertPlatformCapability(runtime.admin, "lifecycle");
  const reason = requireReason(input.reason);

  if (input.role !== "owner") {
    const { data: owners } = await runtime.db
      .from("workspace_memberships")
      .select("user_id")
      .eq("workspace_id", input.workspaceId)
      .eq("role", "owner")
      .eq("status", "active");
    const remaining = (owners ?? []).filter((row) => row.user_id !== input.userId);
    if ((owners ?? []).some((row) => row.user_id === input.userId) && remaining.length === 0) {
      throw new Error("A workspace must keep at least one active owner.");
    }
  }

  const { error } = await runtime.db
    .from("workspace_memberships")
    .update({ role: input.role })
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId);
  if (error) throw new Error("Membership role change failed.");

  await recordPlatformAudit(runtime, {
    action: "membership.role_changed",
    targetWorkspaceId: input.workspaceId,
    targetUserId: input.userId,
    safeDetails: { role: input.role, reason }
  });
}

function requireReason(value: string) {
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 400) {
    throw new Error("This action needs a reason between 3 and 400 characters.");
  }
  return reason;
}
