import "server-only";

import { platformAdminRoles, type PlatformAdminRole } from "../contracts";
import { recordPlatformAudit } from "./audit";
import { requireReason } from "./reason";
import { assertPlatformCapability, type PlatformAdminRuntime } from "./runtime";

export type StaffRow = Readonly<{
  userId: string;
  role: PlatformAdminRole;
  status: "active" | "disabled";
  grantedBy: string | null;
  grantedReason: string;
  createdAt: string;
}>;

export async function listStaff(runtime: PlatformAdminRuntime): Promise<readonly StaffRow[]> {
  const { data, error } = await runtime.db
    .from("platform_admins")
    .select("user_id,role,status,granted_by,granted_reason,created_at")
    .order("created_at");
  if (error) throw new Error("Staff read failed.");
  return (data ?? []).map((row) => ({
    userId: row.user_id as string,
    role: row.role as PlatformAdminRole,
    status: row.status as "active" | "disabled",
    grantedBy: (row.granted_by as string | null) ?? null,
    grantedReason: row.granted_reason as string,
    createdAt: row.created_at as string
  }));
}

/**
 * Refuses a change that would leave the installation with no active owner.
 *
 * Shared by revocation and role changes because both reach the same state by
 * different routes, and only one of them used to check. An installation with no
 * `platform_owner` cannot grant one back: `/admin/staff` is owner-only, so the
 * way out is rerunning the bootstrap script against production with the
 * service-role key, which is exactly the credential the console exists to avoid
 * needing.
 */
async function assertAnOwnerRemains(
  runtime: PlatformAdminRuntime,
  userId: string,
  options: Readonly<{ message: string }>
) {
  const { data: owners } = await runtime.db
    .from("platform_admins")
    .select("user_id")
    .eq("role", "platform_owner")
    .eq("status", "active");
  const isOwner = (owners ?? []).some((row) => row.user_id === userId);
  if (!isOwner) return;
  const remaining = (owners ?? []).filter((row) => row.user_id !== userId);
  if (remaining.length === 0) throw new Error(options.message);
}

/**
 * Grant or change staff access.
 *
 * Restricted to `platform_owner`, and that is the whole point of having three
 * roles: a support hire who can read every workspace should not be one form
 * submission away from promoting themselves to the role that can suspend
 * customers. `assertPlatformCapability` enforces it, and the ledger records who
 * granted what to whom.
 *
 * Two things this refuses, both of which it used to allow because only
 * `revokeStaff` was guarding the same states:
 *
 *   * Demoting the last active owner — including yourself, which the staff
 *     table's own "Change role" control makes a single form submission away.
 *     `revokeStaff` has always refused to remove that person; demoting them
 *     reaches the identical dead end and now refuses identically.
 *   * Silently reinstating somebody whose access was revoked. The row is
 *     disabled rather than deleted, so an upsert that set `status: 'active'`
 *     turned a role edit into a restoration of cross-tenant access, recorded
 *     as `staff.granted` like any other edit. Reinstatement is still available
 *     — it is just its own decision, with its own word on the button and its
 *     own line in the ledger.
 */
export async function setStaffRole(
  runtime: PlatformAdminRuntime,
  input: Readonly<{
    userId: string;
    role: PlatformAdminRole;
    reason: string;
    /** Say so explicitly to bring a revoked account back. */
    reinstate?: boolean;
  }>
) {
  assertPlatformCapability(runtime.admin, "staff");
  const reason = requireReason(input.reason);
  if (!platformAdminRoles.includes(input.role)) throw new Error("Unknown staff role.");

  const { data: profile } = await runtime.db
    .from("profiles")
    .select("id")
    .eq("id", input.userId)
    .maybeSingle();
  if (!profile) throw new Error("That account does not exist.");

  const { data: existing } = await runtime.db
    .from("platform_admins")
    .select("role,status")
    .eq("user_id", input.userId)
    .maybeSingle();
  const wasRevoked = existing?.status === "disabled";
  if (wasRevoked && input.reinstate !== true) {
    throw new Error("That person's access was revoked. Reinstate it explicitly to restore it.");
  }

  if (input.role !== "platform_owner") {
    await assertAnOwnerRemains(runtime, input.userId, {
      message: "At least one active platform owner must remain."
    });
  }

  const { error } = await runtime.db.from("platform_admins").upsert(
    {
      user_id: input.userId,
      role: input.role,
      status: "active",
      granted_by: runtime.admin.userId,
      granted_reason: reason,
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );
  if (error) throw new Error("Staff grant failed.");

  await recordPlatformAudit(runtime, {
    // Three different events, not one. A reviewer scanning the ledger for how
    // somebody came to hold cross-tenant access should not have to infer it
    // from the role field of a line that says "granted" either way.
    action: wasRevoked ? "staff.reinstated" : existing ? "staff.role_changed" : "staff.granted",
    targetUserId: input.userId,
    safeDetails: {
      role: input.role,
      ...(existing ? { previous_role: String(existing.role) } : {}),
      reason
    }
  });
}

/**
 * Withdraw staff access.
 *
 * Disabled rather than deleted, so the ledger's `actor_id` references keep
 * resolving to a row that explains who that person was. Refuses to remove the
 * last active owner: an installation with no `platform_owner` has no way to
 * grant one back except by rerunning the bootstrap script against production.
 */
export async function revokeStaff(
  runtime: PlatformAdminRuntime,
  input: Readonly<{ userId: string; reason: string }>
) {
  assertPlatformCapability(runtime.admin, "staff");
  const reason = requireReason(input.reason);

  await assertAnOwnerRemains(runtime, input.userId, {
    message: "At least one active platform owner must remain."
  });

  const { error } = await runtime.db
    .from("platform_admins")
    .update({ status: "disabled", updated_at: new Date().toISOString() })
    .eq("user_id", input.userId);
  if (error) throw new Error("Staff revocation failed.");

  // Staff access is read through the caller's own session on every request, so
  // the row change is enough to close the console. The sign-out is about the
  // customer-facing session the same person holds, which a revocation is
  // usually meant to end as well.
  await runtime.db.auth.admin.signOut(input.userId, "global").catch(() => undefined);

  await recordPlatformAudit(runtime, {
    action: "staff.revoked",
    targetUserId: input.userId,
    safeDetails: { reason }
  });
}
