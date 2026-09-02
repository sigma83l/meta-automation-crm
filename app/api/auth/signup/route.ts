import type { NextRequest } from "next/server";

import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { authContext, resultResponse } from "@/src/modules/auth/http";
import { createAuthService } from "@/src/modules/auth/runtime";
import { requireCsrf } from "@/src/modules/auth/security/route";
import { platformBlockedResponse } from "@/src/modules/features/http";
import { isPlatformSwitchEnabled } from "@/src/modules/features/server/gate";

export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;

  // Read through the service-role client, not the caller's. The switch table
  // grants SELECT to `authenticated`, and whoever is signing up is `anon` by
  // definition — asking as them would return no row, which the fail-closed gate
  // below would then read as "signups are off" for everybody, always.
  //
  // Failing closed on an unreadable switch is deliberate and costs nothing
  // here: signup provisions a profile, a workspace and an ownership row through
  // the same connection, so a database that cannot answer this question was
  // never going to complete the registration either.
  const admin = await createSupabaseAdminClient();
  if (!(await isPlatformSwitchEnabled(admin, "public_signup"))) {
    return platformBlockedResponse("public_signup");
  }

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
