import { type NextRequest } from "next/server";

import { requiredString, withPlatformAdmin } from "@/src/modules/platform-admin/http";
import { setWorkspaceStatus } from "@/src/modules/platform-admin/server/lifecycle";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return withPlatformAdmin(request, "lifecycle", async (runtime, body) => {
    const status = requiredString(body, "status");
    if (status !== "active" && status !== "disabled") {
      throw new Error("status must be active or disabled.");
    }
    await setWorkspaceStatus(runtime, {
      workspaceId: requiredString(body, "workspaceId"),
      status,
      reason: requiredString(body, "reason")
    });
    return { status };
  });
}
