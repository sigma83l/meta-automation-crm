import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type TrustedWorkspace = Readonly<{ id: string; name: string; userId: string }>;

export async function resolveTrustedWorkspace(client: SupabaseClient): Promise<TrustedWorkspace> {
  const [{ data: userData }, { data, error }] = await Promise.all([
    client.auth.getUser(),
    client.rpc("resolve_workspace", { workspace_hint: null })
  ]);
  const row = Array.isArray(data)
    ? (data[0] as { workspace_id: string; workspace_name: string } | undefined)
    : undefined;
  if (error || !row || !userData.user) throw new Error("Active workspace membership required.");
  return { id: row.workspace_id, name: row.workspace_name, userId: userData.user.id };
}
