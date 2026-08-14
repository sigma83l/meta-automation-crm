import "server-only";

import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { resolveEntitledWorkspace } from "@/src/modules/billing/entitlement-gate";
import { SupabaseCrmRepository } from "./adapters/supabase-crm-repository";

export async function createCrmRuntime() {
  const client = await createSupabaseServerClient();
  const workspace = await resolveEntitledWorkspace(client);
  return { client, workspace, repository: new SupabaseCrmRepository(client, workspace) };
}
