import { notFound } from "next/navigation";
import { listAutomations } from "@/src/modules/automations/service";
import { AutomationActions } from "@/src/modules/automations/ui/automation-builder";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";
const tabs = ["Overview", "Runs", "Versions", "Analytics", "Settings"];
export default async function AutomationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { workspace } = await createMetaRuntime();
  const id = (await params).id;
  const item = (await listAutomations(workspace)).find((row) => row.id === id);
  if (!item) notFound();
  return (
    <WorkspaceShell active="automations" workspaceName={workspace.name}>
      <div className="content">
        <section className="customer-hero">
          <span className="eyebrow">{item.recipe.replaceAll("_", " ")}</span>
          <h2>{item.name}</h2>
          <p>Status: {item.status}</p>
        </section>
        <nav className="detail-tabs" aria-label="Automation detail">
          {tabs.map((tab, index) => (
            <a
              href={`#${tab.toLowerCase().replaceAll(" ", "-")}`}
              aria-current={index === 0 ? "page" : undefined}
              key={tab}
            >
              {tab}
            </a>
          ))}
        </nav>
        <section className="detail-panel">
          <h2>Overview</h2>
          <p>
            Version 1 is immutable. Every send rechecks workspace, connection, consent, window,
            confidence and takeover policy.
          </p>
          {workspace.role === "viewer" ? (
            <p role="status">Viewer access is read-only.</p>
          ) : (
            <AutomationActions id={id} status={item.status} />
          )}
          <div className="state-grid">
            <article>
              <strong>Connection</strong>
              <span>Sandbox healthy</span>
            </article>
            <article>
              <strong>Last failure</strong>
              <span>No recent failure</span>
            </article>
            <article>
              <strong>Queued steps</strong>
              <span>0 pending</span>
            </article>
          </div>
        </section>
      </div>
    </WorkspaceShell>
  );
}
