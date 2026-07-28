import "server-only";

import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { resolveTrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import { SupabaseCrmRepository } from "./adapters/supabase-crm-repository";

export async function createCrmRuntime() {
  const client = await createSupabaseServerClient();
  const workspace = await resolveTrustedWorkspace(client);
  return { client, workspace, repository: new SupabaseCrmRepository(client, workspace) };
}
