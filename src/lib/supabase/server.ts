import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getServerEnvironment } from "@/src/lib/env";
import { createNeonServerClient } from "@/src/lib/neon/server";

export async function createSupabaseServerClient() {
  const environment = getServerEnvironment();
  if (environment.databaseProvider === "neon") return createNeonServerClient();
  if (!environment.supabaseUrl || !environment.supabaseAnonKey) {
    throw new Error("Supabase public configuration is missing.");
  }

  const cookieStore = await cookies();
  return createServerClient(environment.supabaseUrl, environment.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies; proxy.ts performs rotation.
        }
      }
    }
  });
}
