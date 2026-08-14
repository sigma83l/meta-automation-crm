import { listMetaConnections } from "@/src/modules/integrations/meta/connection-service";
import { ConnectionsPanel } from "@/src/modules/integrations/meta/connections-panel";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";
import { getRequestPreferences } from "@/src/lib/i18n/server";
import { BillingEntitlementError } from "@/src/modules/billing/entitlement-gate";
import { EntitlementBlocked } from "@/src/modules/billing/ui/entitlement-blocked";
export const dynamic = "force-dynamic";
export default async function ConnectionsPage() {
  const { locale } = await getRequestPreferences();
  let workspace: Awaited<ReturnType<typeof createMetaRuntime>>["workspace"];
  try {
    ({ workspace } = await createMetaRuntime());
  } catch (error) {
    if (error instanceof BillingEntitlementError) {
      return (
        <WorkspaceShell active="connections" workspaceName={error.workspace.name}>
          <div className="content">
            <EntitlementBlocked locale={locale} status={error.status} />
          </div>
        </WorkspaceShell>
      );
    }
    throw error;
  }
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
