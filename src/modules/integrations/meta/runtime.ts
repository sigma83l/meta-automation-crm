import "server-only";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { resolveEntitledWorkspace } from "@/src/modules/billing/entitlement-gate";
export async function createMetaRuntime() {
  const client = await createSupabaseServerClient();
  const workspace = await resolveEntitledWorkspace(client);
  return { client, workspace };
}
