import "server-only";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { resolveTrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import { BusinessProfileRepository } from "./repository";
export async function createBusinessProfileRuntime() {
  const client = await createSupabaseServerClient();
  const workspace = await resolveTrustedWorkspace(client);
  return { client, workspace, repository: new BusinessProfileRepository(client, workspace) };
}
