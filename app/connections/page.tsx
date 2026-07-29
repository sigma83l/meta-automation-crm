import { listMetaConnections } from "@/src/modules/integrations/meta/connection-service";
import { ConnectionsPanel } from "@/src/modules/integrations/meta/connections-panel";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";
export const dynamic = "force-dynamic";
export default async function ConnectionsPage() {
  const { workspace } = await createMetaRuntime();
  return (
    <WorkspaceShell active="connections" workspaceName={workspace.name}>
      <div className="content">
        <ConnectionsPanel
          connections={await listMetaConnections(workspace)}
          canManage={workspace.role === "owner" || workspace.role === "admin"}
        />
      </div>
    </WorkspaceShell>
  );
}
