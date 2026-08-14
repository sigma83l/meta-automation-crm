import "server-only";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { resolveTrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";

/**
 * Billing itself must stay reachable even when a workspace is unentitled
 * (e.g. past_due) so an owner can fix payment — this intentionally uses
 * resolveTrustedWorkspace, never resolveEntitledWorkspace.
 */
export async function createBillingRuntime() {
  const client = await createSupabaseServerClient();
  const workspace = await resolveTrustedWorkspace(client);
  return { client, workspace };
}
