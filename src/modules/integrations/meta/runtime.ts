import "server-only";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { resolveTrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
export async function createMetaRuntime() {
  const client = await createSupabaseServerClient();
  const workspace = await resolveTrustedWorkspace(client);
  return { client, workspace };
}
