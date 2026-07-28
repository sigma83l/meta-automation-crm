import { LogoutButton } from "@/src/modules/auth/ui/logout-button";

const navItems = ["Overview", "Automations", "CRM", "Inbox", "Integrations", "Settings"];

const setupItems = [
  { label: "Business profile", status: "Ready to configure" },
  { label: "AI provider", status: "Sandbox active" },
  { label: "WhatsApp", status: "Connection required" },
  { label: "Instagram", status: "Connection required" }
];

const activity = [
  { channel: "WA", title: "Inbound lead fixture", detail: "Sandbox · 2 minutes ago" },
  {
    channel: "IG",
    title: "Comment-to-DM policy checked",
    detail: "Blocked safely · 8 minutes ago"
  },
  { channel: "AI", title: "Knowledge fallback verified", detail: "Human review · 12 minutes ago" }
];

export default function Home() {
  return (
    <div className="app-shell">
      <aside className="control-rail">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          <div>
            <strong>Relay CRM</strong>
            <span>Business control</span>
          </div>
        </div>

        <div className="workspace-card">
          <span>Workspace</span>
          <strong>Northstar Studio</strong>
          <small>Synthetic foundation data</small>
        </div>

        <nav aria-label="Main navigation">
          {navItems.map((item, index) => (
            <a
              href={index === 0 ? "#overview" : `#${item.toLowerCase()}`}
              aria-current={index === 0 ? "page" : undefined}
              key={item}
            >
              <span className="nav-glyph" aria-hidden="true">
                {item.slice(0, 2).toUpperCase()}
              </span>
              {item}
            </a>
          ))}
        </nav>

        <div className="safety-lock">
          <span className="status-light" aria-hidden="true" />
          <div>
            <strong>Safe mode</strong>
            <span>Live sends are locked</span>
          </div>
        </div>
      </aside>

      <main id="overview">
        <header className="topbar">
          <div>
            <span className="eyebrow">Monday · Foundation workspace</span>
            <h1>Overview</h1>
          </div>
          <div className="topbar-actions">
            <span className="environment-chip">Sandbox</span>
            <LogoutButton />
          </div>
        </header>

        <div className="content">
          <section className="control-brief" aria-labelledby="brief-title">
            <div className="brief-copy">
              <span className="eyebrow">Control brief</span>
              <h2 id="brief-title">Every conversation stays inside its workspace.</h2>
              <p>
                Connect channels, test the response policy, and activate only after the live gate is
                approved.
              </p>
            </div>
            <div className="signal-lanes" aria-label="Channel readiness">
              <div className="signal-lane signal-lane-whatsapp">
                <span>WhatsApp</span>
                <strong>Sandbox receiving</strong>
              </div>
              <div className="signal-lane signal-lane-instagram">
                <span>Instagram</span>
                <strong>Sandbox receiving</strong>
              </div>
              <div className="signal-lock">
                <span aria-hidden="true">×</span>
                Live send
              </div>
            </div>
          </section>

          <section className="metric-grid" aria-label="Workspace status">
            <article>
              <span>Active automations</span>
              <strong>0</strong>
              <small>Activation starts after Prompt 5</small>
            </article>
            <article>
              <span>Open service windows</span>
              <strong>0</strong>
              <small>No provider events received</small>
            </article>
            <article>
              <span>Human review</span>
              <strong>1</strong>
              <small>Synthetic missing-knowledge case</small>
            </article>
            <article>
              <span>Workspace boundary</span>
              <strong className="word-value">Locked</strong>
              <small>Client IDs never grant authority</small>
            </article>
          </section>

          <div className="dashboard-grid">
            <section className="panel" id="integrations">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Setup</span>
                  <h2>Workspace readiness</h2>
                </div>
                <span>1 of 4 ready</span>
              </div>
              <div className="setup-list">
                {setupItems.map((item, index) => (
                  <article key={item.label}>
                    <span className={index === 1 ? "step done" : "step"} aria-hidden="true">
                      {index === 1 ? "✓" : index + 1}
                    </span>
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.status}</span>
                    </div>
                    <button type="button">{index === 1 ? "Review" : "Configure"}</button>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel" id="inbox">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Evidence</span>
                  <h2>Recent safe activity</h2>
                </div>
                <span>Synthetic only</span>
              </div>
              <div className="activity-list">
                {activity.map((item) => (
                  <article key={item.title}>
                    <span className="channel-badge">{item.channel}</span>
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.detail}</span>
                    </div>
                  </article>
                ))}
              </div>
              <div className="empty-guidance">
                <strong>Real events appear after connection review.</strong>
                <span>Provider secrets never appear in this workspace view.</span>
              </div>
            </section>
          </div>

          <section className="policy-strip" id="automations">
            <div>
              <span className="eyebrow">Send policy</span>
              <strong>Sandbox → approval → allowlist → live adapter</strong>
            </div>
            <span className="policy-state">Fail closed</span>
          </section>
        </div>
      </main>
    </div>
  );
}
