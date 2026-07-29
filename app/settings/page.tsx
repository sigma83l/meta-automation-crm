import { createBusinessProfileRuntime } from "@/src/modules/business-profile/runtime";
import { SettingsPanel } from "@/src/modules/business-profile/ui/settings-panel";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";
export const dynamic = "force-dynamic";
export default async function SettingsPage() {
  const { repository, workspace } = await createBusinessProfileRuntime();
  const data = await repository.get();
  return (
    <WorkspaceShell active="settings" workspaceName={workspace.name}>
      <div className="content">
        {workspace.role === "owner" || workspace.role === "admin" ? (
          <SettingsPanel {...data} />
        ) : (
          <section className="settings-card" role="status">
            <h2>Permission denied</h2>
            <p>
              Your {workspace.role} role cannot change workspace settings or encrypted credentials.
              Ask an Owner or Admin.
            </p>
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
