import type { NextRequest } from "next/server";

import { resultResponse } from "@/src/modules/auth/http";
import { createAuthService } from "@/src/modules/auth/runtime";
import { requireCsrf } from "@/src/modules/auth/security/route";

export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  const body = (await request.json()) as Record<string, unknown>;
  return resultResponse(
    await (await createAuthService()).resetPassword(String(body.password ?? ""))
  );
}
