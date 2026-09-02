import { type NextRequest } from "next/server";

import { requiredString, withPlatformAdmin } from "@/src/modules/platform-admin/http";
import {
  forceSignOut,
  setMembershipRole,
  setUserStatus
} from "@/src/modules/platform-admin/server/lifecycle";

export const dynamic = "force-dynamic";

const membershipRoles = ["owner", "admin", "operator", "viewer"] as const;

export async function POST(request: NextRequest) {
  return withPlatformAdmin(request, "lifecycle", async (runtime, body) => {
    const action = requiredString(body, "action");
    const userId = requiredString(body, "userId");
    const reason = requiredString(body, "reason");

    if (action === "suspend" || action === "restore") {
      await setUserStatus(runtime, {
        userId,
        status: action === "suspend" ? "disabled" : "active",
        reason
      });
      return { action };
    }
    if (action === "sign_out") {
      await forceSignOut(runtime, { userId, reason });
      return { action };
    }
    if (action === "set_role") {
      const role = requiredString(body, "role");
      if (!membershipRoles.includes(role as (typeof membershipRoles)[number])) {
        throw new Error("Unknown workspace role.");
      }
      await setMembershipRole(runtime, {
        workspaceId: requiredString(body, "workspaceId"),
        userId,
        role: role as (typeof membershipRoles)[number],
        reason
      });
      return { action, role };
    }
    throw new Error("Unknown action.");
  });
}
