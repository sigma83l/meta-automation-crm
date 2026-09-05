import { type NextRequest } from "next/server";

import { requiredString, withPlatformAdmin } from "@/src/modules/platform-admin/http";
import { revokeStaff, setStaffRole } from "@/src/modules/platform-admin/server/staff";
import { platformAdminRoles, type PlatformAdminRole } from "@/src/modules/platform-admin/contracts";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return withPlatformAdmin(request, "staff", async (runtime, body) => {
    const action = requiredString(body, "action");
    const userId = requiredString(body, "userId");
    const reason = requiredString(body, "reason");

    if (action === "grant" || action === "reinstate") {
      const role = requiredString(body, "role") as PlatformAdminRole;
      if (!platformAdminRoles.includes(role)) throw new Error("Unknown staff role.");
      // Bringing back a revoked account is its own action rather than a flag on
      // this one, so that restoring cross-tenant access is a thing somebody
      // chose rather than a side effect of editing a role.
      await setStaffRole(runtime, {
        userId,
        role,
        reason,
        ...(action === "reinstate" ? { reinstate: true } : {})
      });
      return { action, role };
    }
    if (action === "revoke") {
      await revokeStaff(runtime, { userId, reason });
      return { action };
    }
    throw new Error("Unknown action.");
  });
}
