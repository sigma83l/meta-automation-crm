import { type NextRequest } from "next/server";

import { requiredString, withPlatformAdmin } from "@/src/modules/platform-admin/http";
import { acknowledgeDeadLetter, requeueOutboxEvent } from "@/src/modules/platform-admin/server/ops";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return withPlatformAdmin(request, "operations", async (runtime, body) => {
    const action = requiredString(body, "action");
    const id = requiredString(body, "id");
    const reason = requiredString(body, "reason");

    if (action === "acknowledge_dead_letter") {
      await acknowledgeDeadLetter(runtime, { id, reason });
      return { action };
    }
    if (action === "requeue_outbox") {
      await requeueOutboxEvent(runtime, { id, reason });
      return { action };
    }
    throw new Error("Unknown action.");
  });
}
