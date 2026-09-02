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
  "/connections",
  // The console fails closed twice over: this redirects an anonymous visitor to
  // the sign-in page, and every route under it then resolves staff identity
  // through `current_platform_admin()` before rendering anything. Middleware
  // knows only that somebody is signed in — it deliberately does not try to
  // decide who is staff, since that answer belongs to the database.
  "/admin"
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
    // Local-only developer convenience. The deployment-mode check is the load
    // bearing half: without it, setting one environment variable in a deployed
    // environment would silently sign in every visitor to a protected route as
    // the bypass user. Middleware reads process.env directly (importing the
    // validated schema here would re-run it on every request), so this fails
    // closed on its own, and assertProductionConfiguration refuses to boot a
    // production build with the flag set.
    if (
      process.env.AUTH_BYPASS_ENABLED === "true" &&
      (process.env.APP_DEPLOYMENT_MODE ?? "local") === "local"
    ) {
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
