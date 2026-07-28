import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServerEnvironment } from "@/src/lib/env";
export function createSupabaseAdminClient() {
  const env = getServerEnvironment();
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey)
    throw new Error("Supabase administrative configuration is missing.");
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false }
  });
}
