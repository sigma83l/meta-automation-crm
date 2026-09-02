import { type NextRequest } from "next/server";

import {
  requiredBoolean,
  requiredString,
  withPlatformAdmin
} from "@/src/modules/platform-admin/http";
import { setSwitch } from "@/src/modules/platform-admin/server/switches";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return withPlatformAdmin(request, "operations", async (runtime, body) => {
    await setSwitch(runtime, {
      key: requiredString(body, "key"),
      enabled: requiredBoolean(body, "enabled"),
      reason: requiredString(body, "reason")
    });
    return { key: requiredString(body, "key") };
  });
}
