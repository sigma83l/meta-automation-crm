import "server-only";

import { PostgrestClient } from "@supabase/postgrest-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

import { getServerEnvironment } from "@/src/lib/env";

type ProviderError = Readonly<{ message: string; status: number }>;
type ProviderResult<T> = Readonly<{ data: T | null; error: ProviderError | null }>;

async function authRequest<T>(
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>
): Promise<ProviderResult<T>> {
  const environment = getServerEnvironment();
  if (!environment.neonAuthBaseUrl) throw new Error("Neon Auth URL is missing.");
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const requestOrigin = forwardedHost
    ? `${forwardedProtocol}://${forwardedHost}`
    : environment.appUrl;
  const response = await fetch(`${environment.neonAuthBaseUrl}/${path}`, {
    method,
    headers: {
      accept: "application/json",
      origin: requestOrigin,
      ...(body ? { "content-type": "application/json" } : {}),
      cookie: cookieStore.toString()
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
    redirect: "manual"
  });
  persistProviderCookies(cookieStore, response.headers.getSetCookie());
  const payload = (await response.json().catch(() => null)) as T | { message?: string } | null;
  if (!response.ok) {
    return {
      data: null,
      error: {
        message:
          payload && typeof payload === "object" && "message" in payload && payload.message
            ? payload.message
            : "Authentication request failed.",
        status: response.status
      }
    };
  }
  return { data: payload as T, error: null };
}

function persistProviderCookies(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  setCookies: readonly string[]
) {
  for (const header of setCookies) {
    const [pair, ...attributes] = header.split(";").map((part) => part.trim());
    const separator = pair?.indexOf("=") ?? -1;
    if (!pair || separator < 1) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    const lowered = attributes.map((attribute) => attribute.toLowerCase());
    const maxAge = attributes.find((attribute) => attribute.toLowerCase().startsWith("max-age="));
    const expires = attributes.find((attribute) => attribute.toLowerCase().startsWith("expires="));
    const sameSiteAttribute = lowered.find((attribute) => attribute.startsWith("samesite="));
    const sameSiteValue = sameSiteAttribute?.split("=")[1];
    cookieStore.set(name, value, {
      httpOnly: lowered.includes("httponly"),
      secure: lowered.includes("secure"),
      path:
        attributes.find((attribute) => attribute.toLowerCase().startsWith("path="))?.slice(5) ??
        "/",
      ...(maxAge ? { maxAge: Number(maxAge.slice(8)) } : {}),
      ...(expires ? { expires: new Date(expires.slice(8)) } : {}),
      ...(sameSiteValue === "strict" || sameSiteValue === "lax" || sameSiteValue === "none"
        ? { sameSite: sameSiteValue }
        : { sameSite: "strict" as const })
    });
  }
}

async function currentJwt(): Promise<string | null> {
  const result = await authRequest<{ token?: string }>("token", "GET");
  return result.error ? null : (result.data?.token ?? null);
}

function disabledStorage() {
  const unsupported = async () => ({
    data: null,
    error: new Error("Hosted private object storage is not configured for this Preview.")
  });
  return {
    from: () => ({
      upload: unsupported,
      download: unsupported,
      remove: unsupported,
      createSignedUrl: unsupported
    })
  };
}

export async function createNeonServerClient(): Promise<SupabaseClient> {
  const environment = getServerEnvironment();
  if (!environment.neonDataApiUrl) throw new Error("Neon Data API URL is missing.");
  const data = new PostgrestClient(environment.neonDataApiUrl, {
    fetch: async (input, init) => {
      const token = await currentJwt();
      if (!token) throw new Error("Authenticated Neon session required.");
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${token}`);
      return fetch(input, { ...init, headers, cache: "no-store" });
    }
  });
  const auth = {
    signUp: async (input: {
      email: string;
      password: string;
      options?: { data?: { business_name?: string } };
    }) => {
      const result = await authRequest<{ user?: unknown; token?: string }>(
        "sign-up/email",
        "POST",
        {
          email: input.email,
          password: input.password,
          name: input.options?.data?.business_name ?? "My business"
        }
      );
      return {
        data: { user: result.data?.user ?? null, session: result.data?.token ? result.data : null },
        error: result.error
      };
    },
    signInWithPassword: async (input: { email: string; password: string }) => {
      const result = await authRequest<{ user?: unknown; token?: string }>(
        "sign-in/email",
        "POST",
        input
      );
      return {
        data: { user: result.data?.user ?? null, session: result.data?.token ? result.data : null },
        error: result.error
      };
    },
    getUser: async () => {
      const result = await authRequest<{ user?: unknown }>("get-session", "GET");
      return { data: { user: result.data?.user ?? null }, error: result.error };
    },
    getSession: async () => {
      const result = await authRequest<{ user?: unknown; session?: unknown }>("get-session", "GET");
      return { data: { session: result.data }, error: result.error };
    },
    signOut: async ({ scope }: { scope?: "global" | "local" } = {}) => {
      if (scope === "global") await authRequest("revoke-sessions", "POST", {});
      const result = await authRequest("sign-out", "POST", {});
      return { error: result.error };
    },
    resetPasswordForEmail: async (email: string, options?: { redirectTo?: string }) => {
      const result = await authRequest("request-password-reset", "POST", {
        email,
        redirectTo: options?.redirectTo
      });
      return { data: result.data, error: result.error };
    },
    updateUser: async () => ({
      data: { user: null },
      error: { message: "Managed password-reset token required.", status: 400 }
    })
  };
  return Object.assign(data, {
    auth,
    storage: disabledStorage(),
    __applicationProvider: "neon"
  }) as unknown as SupabaseClient;
}
