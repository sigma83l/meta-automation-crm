import Link from "next/link";
import { WorkspaceShell } from "./workspace-shell";
export function DashboardOverview({
  workspaceName,
  metrics
}: {
  workspaceName: string;
  metrics: {
    automations: number;
    windows: number;
    customers: number;
    reviews: number;
    errors: number;
    whatsapp: string;
    instagram: string;
  };
}) {
  const checklist: ReadonlyArray<readonly [string, string]> = [
    ["Business profile", "/settings"],
    ["Brand, pricing and FAQs", "/settings"],
    ["AI provider", "/settings"],
    ["Connect channels", "/connections"],
    ["Create first automation", "/automations"]
  ];
  return (
    <WorkspaceShell active="overview" workspaceName={workspaceName}>
      <div className="content">
        <section className="control-brief">
          <div className="brief-copy">
            <span className="eyebrow">Next safe action</span>
            <h2>Turn one inbound conversation into a complete customer record.</h2>
            <p>
              Finish setup, run a Sandbox test, and activate only when every policy check is ready.
            </p>
            <Link className="primary-link" href="/automations">
              Create automation
            </Link>
          </div>
          <div className="signal-lanes" aria-label="Connection health">
            <div className="signal-lane signal-lane-whatsapp">
              <span>WhatsApp</span>
              <strong>{metrics.whatsapp}</strong>
            </div>
            <div className="signal-lane signal-lane-instagram">
              <span>Instagram</span>
              <strong>{metrics.instagram}</strong>
            </div>
            <div className="signal-lock">
              <span aria-hidden>×</span>Live sends are locked
            </div>
          </div>
        </section>
        <section className="metric-grid" aria-label="Workspace status">
          <article>
            <span>Active automations</span>
            <strong>{metrics.automations}</strong>
            <small>Policy checked</small>
          </article>
          <article>
            <span>Open service windows</span>
            <strong>{metrics.windows}</strong>
            <small>Trusted provider events</small>
          </article>
          <article>
            <span>New customers</span>
            <strong>{metrics.customers}</strong>
            <small>Workspace CRM</small>
          </article>
          <article>
            <span>Human review</span>
            <strong>{metrics.reviews}</strong>
            <small>{metrics.errors} recent errors</small>
          </article>
        </section>
        <div className="dashboard-grid">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Setup</span>
                <h2>Launch checklist</h2>
              </div>
              <span>Resumable</span>
            </div>
            <div className="setup-list">
              {checklist.map(([label, href], index) => (
                <article key={label}>
                  <span className="step">{index + 1}</span>
                  <div>
                    <strong>{label}</strong>
                    <span>{index < 2 ? "Review details" : "Action required"}</span>
                  </div>
                  <Link href={href}>Open</Link>
                </article>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Activity</span>
                <h2>What needs attention</h2>
              </div>
              <span>Sandbox</span>
            </div>
            <div className="activity-list">
              <article>
                <span className="channel-badge">HR</span>
                <div>
                  <strong>Human-review queue</strong>
                  <span>{metrics.reviews} conversations waiting</span>
                </div>
              </article>
              <article>
                <span className="channel-badge">ER</span>
                <div>
                  <strong>Recent errors</strong>
                  <span>{metrics.errors} recoverable items</span>
                </div>
              </article>
              <article>
                <span className="channel-badge">CRM</span>
                <div>
                  <strong>Customer activity</strong>
                  <span>{metrics.customers} customer records</span>
                </div>
              </article>
            </div>
          </section>
        </div>
      </div>
    </WorkspaceShell>
  );
}
