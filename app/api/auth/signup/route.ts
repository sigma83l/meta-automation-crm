import type { NextRequest } from "next/server";

import { authContext, resultResponse } from "@/src/modules/auth/http";
import { createAuthService } from "@/src/modules/auth/runtime";
import { requireCsrf } from "@/src/modules/auth/security/route";

export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  const body = (await request.json()) as Record<string, unknown>;
  const service = await createAuthService();
  return resultResponse(
    await service.signup(
      {
        email: String(body.email ?? ""),
        password: String(body.password ?? ""),
        businessName: String(body.businessName ?? "")
      },
      authContext(request, String(body.captchaToken ?? ""))
    ),
    201
  );
}
