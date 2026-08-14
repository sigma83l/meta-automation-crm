import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const protectedPrefixes = [
  "/dashboard",
  "/onboarding",
  "/automations",
  "/analytics",
  "/crm",
  "/inbox",
  "/settings",
  "/connections"
];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const isProtected = protectedPrefixes.some((path) => request.nextUrl.pathname.startsWith(path));
  if (process.env.DATABASE_PROVIDER === "neon" && isProtected) {
    const authUrl = process.env.NEON_AUTH_BASE_URL;
    if (!authUrl) return redirectToLogin(request);
    const session = await fetch(`${authUrl}/get-session`, {
      headers: {
        cookie: request.cookies.toString(),
        origin: request.nextUrl.origin
      },
      cache: "no-store"
    }).catch(() => null);
    if (!session?.ok) return redirectToLogin(request);
    const payload = (await session.json().catch(() => null)) as { user?: unknown } | null;
    if (!payload?.user) return redirectToLogin(request);
    return response;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      }
    }
  });
  const { data } = await client.auth.getUser();
  if (!data.user && isProtected) {
    if (process.env.AUTH_BYPASS_ENABLED === "true") {
      const bypassEmail = process.env.AUTH_BYPASS_EMAIL;
      const bypassPassword = process.env.AUTH_BYPASS_PASSWORD;
      if (bypassEmail && bypassPassword) {
        const { error } = await client.auth.signInWithPassword({
          email: bypassEmail,
          password: bypassPassword
        });
        if (!error) return response;
      }
    }
    return redirectToLogin(request);
  }
  return response;
}

function redirectToLogin(request: NextRequest) {
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
