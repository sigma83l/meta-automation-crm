import { type NextRequest } from "next/server";

import {
  optionalInteger,
  requiredString,
  withPlatformAdmin
} from "@/src/modules/platform-admin/http";
import {
  closeImpersonation,
  openImpersonation
} from "@/src/modules/platform-admin/server/impersonation";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return withPlatformAdmin(request, "impersonate", async (runtime, body) => {
    const action = requiredString(body, "action");
    const workspaceId = requiredString(body, "workspaceId");

    if (action === "open") {
      const grant = await openImpersonation(runtime, {
        workspaceId,
        reason: requiredString(body, "reason"),
        minutes: optionalInteger(body, "minutes") ?? 15
      });
      return { expiresAt: grant.expiresAt };
    }
    if (action === "close") {
      const revoked = await closeImpersonation(runtime, workspaceId);
      return { revoked };
    }
    throw new Error("Unknown action.");
  });
}
