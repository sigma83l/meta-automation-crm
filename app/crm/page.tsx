import { createCrmRuntime } from "@/src/modules/crm/runtime";
import { CrmControls } from "@/src/modules/crm/ui/crm-controls";
import { CustomerTable } from "@/src/modules/crm/ui/customer-table";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";

export const dynamic = "force-dynamic";

export default async function CrmPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const { repository, workspace } = await createCrmRuntime();
  const customers = await repository.list({
    ...(params.q ? { query: params.q } : {}),
    ...(params.status === "active" || params.status === "archived" ? { status: params.status } : {})
  });
  return (
    <WorkspaceShell active="crm" workspaceName={workspace.name}>
      <div className="content crm-content">
        {workspace.role === "viewer" ? (
          <section className="panel" role="status">
            <h2>Read-only access</h2>
            <p>
              Your Viewer role can review CRM records but cannot create, import, or export them.
            </p>
          </section>
        ) : (
          <CrmControls />
        )}
        <CustomerTable customers={customers} />
      </div>
    </WorkspaceShell>
  );
}
