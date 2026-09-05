import { type NextRequest } from "next/server";

import {
  optionalInteger,
  requiredString,
  withPlatformAdmin
} from "@/src/modules/platform-admin/http";
import {
  adminReachableStatuses,
  extendTrial,
  resumeTrial,
  setSubscriptionStatus,
  setWorkspacePlan,
  type AdminReachableStatus
} from "@/src/modules/platform-admin/server/billing-overrides";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return withPlatformAdmin(request, "billing", async (runtime, body) => {
    const action = requiredString(body, "action");
    const workspaceId = requiredString(body, "workspaceId");
    const reason = requiredString(body, "reason");

    if (action === "set_status") {
      const status = requiredString(body, "status") as AdminReachableStatus;
      if (!adminReachableStatuses.includes(status)) {
        throw new Error("That subscription status cannot be set from the console.");
      }
      const planId = typeof body.planId === "string" ? body.planId : null;
      await setSubscriptionStatus(runtime, { workspaceId, status, planId, reason });
      return { action, status };
    }
    if (action === "set_plan") {
      await setWorkspacePlan(runtime, {
        workspaceId,
        planId: requiredString(body, "planId"),
        reason
      });
      return { action };
    }
    if (action === "resume_trial") {
      await resumeTrial(runtime, { workspaceId, reason });
      return { action };
    }
    if (action === "extend_trial") {
      const days = optionalInteger(body, "days");
      if (days === undefined) throw new Error("days is required.");
      await extendTrial(runtime, { workspaceId, days, reason });
      return { action, days };
    }
    throw new Error("Unknown action.");
  });
}
