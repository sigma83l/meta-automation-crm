import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { requireCsrf } from "@/src/modules/auth/security/route";

export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("complete_auth_onboarding");
  return error
    ? NextResponse.json({ ok: false }, { status: 400 })
    : NextResponse.json({ ok: true });
}
