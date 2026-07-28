import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const allowedDestinations = new Set(["/dashboard", "/onboarding", "/reset-password"]);

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const requestedNext = request.nextUrl.searchParams.get("next") ?? "/dashboard";
  const next = allowedDestinations.has(requestedNext) ? requestedNext : "/dashboard";
  if (code) {
    const client = await createSupabaseServerClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  return NextResponse.redirect(new URL("/login?error=session", request.url));
}
