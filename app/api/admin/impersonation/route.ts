import { type NextRequest } from "next/server";

import {
  optionalInteger,
  requiredString,
  withPlatformAdmin
} from "@/src/modules/platform-admin/http";
import {
  closeImpersonation,
  closeImpersonationGrant,
  openImpersonation
} from "@/src/modules/platform-admin/server/impersonation";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return withPlatformAdmin(request, "impersonate", async (runtime, body) => {
    const action = requiredString(body, "action");

    // Closing a named grant is the only action that does not name a workspace:
    // it is reached from the overview, which lists windows rather than tenants,
    // and the grant already knows which workspace it belongs to.
    if (action === "close_grant") {
      const revoked = await closeImpersonationGrant(runtime, requiredString(body, "grantId"));
      return { revoked };
    }

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
