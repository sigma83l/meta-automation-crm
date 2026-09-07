import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { requireCsrf } from "@/src/modules/auth/security/route";

/**
 * Adopts a recovery session that arrived in a URL fragment.
 *
 * The tokens are already in the browser's hands — GoTrue put them there — so
 * this grants nothing that was not already granted. What it does is move them
 * out of the URL and into the same cookies every other route reads, which is
 * what lets the reset form, and everything after it, stay server-side.
 *
 * CSRF is required despite the caller holding valid tokens. Without it a page
 * on another origin could post *its own* tokens here and quietly plant its
 * session in this browser, and the victim would then change the password of an
 * account belonging to somebody else.
 */
export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;

  const body = (await request.json()) as Record<string, unknown>;
  const accessToken = typeof body.accessToken === "string" ? body.accessToken : "";
  const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken : "";
  if (!accessToken || !refreshToken) {
    return NextResponse.json({ error: "AUTH_SESSION_INVALID" }, { status: 400 });
  }

  const client = await createSupabaseServerClient();
  const { error } = await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken
  });
  // The message is deliberately not passed through: a rejected token and an
  // expired one are the same event to whoever is looking at the screen, and the
  // difference is worth nothing to them and something to an attacker.
  if (error) return NextResponse.json({ error: "AUTH_SESSION_INVALID" }, { status: 401 });

  return NextResponse.json({ ok: true });
}
