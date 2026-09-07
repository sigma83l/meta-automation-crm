import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const allowedDestinations = new Set(["/dashboard", "/onboarding", "/reset-password"]);

/**
 * Two shapes of link arrive here, and only one of them is visible to a server.
 *
 * A PKCE link carries `?code=`, which is a query parameter and reaches us. A
 * recovery link from GoTrue's `/verify` endpoint carries the session in the URL
 * *fragment* — `#access_token=...&refresh_token=...&type=recovery` — and a
 * fragment is never sent to the server at all. This route used to read only
 * `code`, find nothing, and send every password-reset link straight to
 * `/login?error=session`, which is exactly what it looked like: the reset link
 * never reaching the reset page.
 *
 * The handoff below works because a redirect whose target has no fragment of
 * its own leaves the original one attached, so `/auth/recover` still sees the
 * tokens the browser has been holding all along.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const requestedNext = request.nextUrl.searchParams.get("next") ?? "/dashboard";
  const next = allowedDestinations.has(requestedNext) ? requestedNext : "/dashboard";
  if (code) {
    const client = await createSupabaseServerClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
    return NextResponse.redirect(new URL("/login?error=session", request.url));
  }
  // No code. Either a fragment link, which only the browser can read, or a
  // malformed one — `/auth/recover` is what can tell the two apart.
  return NextResponse.redirect(
    new URL(`/auth/recover?next=${encodeURIComponent(next)}`, request.url)
  );
}
