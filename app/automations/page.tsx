import Link from "next/link";
import { listAutomations } from "@/src/modules/automations/service";
import { AutomationBuilder } from "@/src/modules/automations/ui/automation-builder";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";
export const dynamic = "force-dynamic";
export default async function AutomationsPage() {
  const { workspace } = await createMetaRuntime();
  const items = await listAutomations(workspace);
  return (
    <WorkspaceShell active="automations" workspaceName={workspace.name}>
      <div className="content">
        {workspace.role === "viewer" ? (
          <section className="panel" role="status">
            <h2>Read-only access</h2>
            <p>Your Viewer role can inspect automations but cannot create or change them.</p>
          </section>
        ) : (
          <AutomationBuilder />
        )}
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Workspace</span>
              <h2>Automations</h2>
            </div>
            <span>{items.length} total</span>
          </div>
          {items.length ? (
            <div className="automation-list">
              {items.map((item) => (
                <Link href={`/automations/${item.id}`} key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.recipe.replaceAll("_", " ")}</span>
                  </div>
                  <span className="status-pill">{item.status}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-guidance">
              <strong>No automations yet.</strong>
              <span>Choose a recipe above to create the first safe draft.</span>
            </div>
          )}
        </section>
      </div>
    </WorkspaceShell>
  );
}
