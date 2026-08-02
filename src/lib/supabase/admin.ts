import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServerEnvironment } from "@/src/lib/env";
import { createNeonServerClient } from "@/src/lib/neon/server";
export async function createSupabaseAdminClient() {
  const env = getServerEnvironment();
  if (env.databaseProvider === "neon") return createNeonServerClient();
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey)
    throw new Error("Supabase administrative configuration is missing.");
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false }
  });
}
