import "server-only";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { resolveEntitledWorkspace } from "@/src/modules/billing/entitlement-gate";
import { BusinessProfileRepository } from "./repository";
export async function createBusinessProfileRuntime() {
  const client = await createSupabaseServerClient();
  const workspace = await resolveEntitledWorkspace(client);
  return { client, workspace, repository: new BusinessProfileRepository(client, workspace) };
}
