import { type NextRequest } from "next/server";

import {
  optionalInteger,
  requiredBoolean,
  requiredString,
  withPlatformAdmin
} from "@/src/modules/platform-admin/http";
import {
  clearWorkspaceFeatureOverride,
  setFlagArchived,
  setPlanFeatureDefault,
  setWorkspaceFeatureOverride
} from "@/src/modules/platform-admin/server/feature-flags";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return withPlatformAdmin(request, "features", async (runtime, body) => {
    const action = requiredString(body, "action");

    if (action === "set_override") {
      const expiresInDays = optionalInteger(body, "expiresInDays");
      await setWorkspaceFeatureOverride(runtime, {
        workspaceId: requiredString(body, "workspaceId"),
        flagKey: requiredString(body, "flagKey"),
        enabled: requiredBoolean(body, "enabled"),
        reason: requiredString(body, "reason"),
        ...(expiresInDays === undefined ? {} : { expiresInDays })
      });
      return { action };
    }
    if (action === "clear_override") {
      await clearWorkspaceFeatureOverride(runtime, {
        workspaceId: requiredString(body, "workspaceId"),
        flagKey: requiredString(body, "flagKey")
      });
      return { action };
    }
    if (action === "set_plan_default") {
      await setPlanFeatureDefault(runtime, {
        planId: requiredString(body, "planId"),
        flagKey: requiredString(body, "flagKey"),
        enabled: requiredBoolean(body, "enabled")
      });
      return { action };
    }
    if (action === "set_archived") {
      await setFlagArchived(runtime, {
        flagKey: requiredString(body, "flagKey"),
        archived: requiredBoolean(body, "archived")
      });
      return { action };
    }
    throw new Error("Unknown action.");
  });
}
