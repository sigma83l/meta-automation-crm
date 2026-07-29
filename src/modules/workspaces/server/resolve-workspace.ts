import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkspaceRole = "owner" | "admin" | "operator" | "viewer";
export type TrustedWorkspace = Readonly<{
  id: string;
  name: string;
  userId: string;
  role: WorkspaceRole;
}>;

export async function resolveTrustedWorkspace(client: SupabaseClient): Promise<TrustedWorkspace> {
  const [{ data: userData }, { data, error }] = await Promise.all([
    client.auth.getUser(),
    client.rpc("resolve_workspace", { workspace_hint: null })
  ]);
  const row = Array.isArray(data)
    ? (data[0] as { workspace_id: string; workspace_name: string } | undefined)
    : undefined;
  if (error || !row || !userData.user) throw new Error("Active workspace membership required.");
  const membership = await client
    .from("workspace_memberships")
    .select("role")
    .eq("workspace_id", row.workspace_id)
    .eq("user_id", userData.user.id)
    .eq("status", "active")
    .single();
  if (membership.error || !membership.data) throw new Error("Active workspace role required.");
  return {
    id: row.workspace_id,
    name: row.workspace_name,
    userId: userData.user.id,
    role: membership.data.role as WorkspaceRole
  };
}

export function assertWorkspaceOperator(workspace: TrustedWorkspace) {
  if (!["owner", "admin", "operator"].includes(workspace.role)) {
    throw new Error("Workspace operator permission required.");
  }
}

export function assertWorkspaceManager(workspace: TrustedWorkspace) {
  if (!["owner", "admin"].includes(workspace.role)) {
    throw new Error("Workspace manager permission required.");
  }
}
