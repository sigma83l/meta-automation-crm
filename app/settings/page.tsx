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
        <SettingsPanel {...data} />
      </div>
    </WorkspaceShell>
  );
}
