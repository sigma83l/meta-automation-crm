import Link from "next/link";
import type { ReactNode } from "react";

import { LogoutButton } from "@/src/modules/auth/ui/logout-button";

export function WorkspaceShell({
  active,
  workspaceName,
  children
}: {
  active: "overview" | "automations" | "crm" | "inbox" | "settings" | "connections";
  workspaceName: string;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <aside className="control-rail">
        <Link className="brand-lockup" href="/dashboard">
          <span className="brand-mark">R</span>
          <div>
            <strong>Relay CRM</strong>
            <span>Business control</span>
          </div>
        </Link>
        <div className="workspace-card">
          <span>Workspace</span>
          <strong>{workspaceName}</strong>
          <small>Private tenant</small>
        </div>
        <nav aria-label="Main navigation">
          <Link href="/dashboard" aria-current={active === "overview" ? "page" : undefined}>
            <span className="nav-glyph">OV</span>Overview
          </Link>
          <Link href="/automations" aria-current={active === "automations" ? "page" : undefined}>
            <span className="nav-glyph">AU</span>Automations
          </Link>
          <Link href="/crm" aria-current={active === "crm" ? "page" : undefined}>
            <span className="nav-glyph">CR</span>CRM
          </Link>
          <Link href="/inbox" aria-current={active === "inbox" ? "page" : undefined}>
            <span className="nav-glyph">IN</span>Inbox
          </Link>
          <Link href="/connections" aria-current={active === "connections" ? "page" : undefined}>
            <span className="nav-glyph">IN</span>Integrations
          </Link>
          <Link href="/settings" aria-current={active === "settings" ? "page" : undefined}>
            <span className="nav-glyph">SE</span>Settings
          </Link>
        </nav>
        <div className="safety-lock">
          <span className="status-light" />
          <div>
            <strong>Safe mode</strong>
            <span>No real provider sending</span>
          </div>
        </div>
      </aside>
      <main className="workspace-main">
        <header className="topbar">
          <div>
            <span className="eyebrow">Workspace data</span>
            <h1>
              {active === "overview"
                ? "Overview"
                : active === "automations"
                  ? "Automations"
                  : active === "crm"
                    ? "CRM"
                    : active === "inbox"
                      ? "Inbox"
                      : active === "connections"
                        ? "Integrations"
                        : "Settings"}
            </h1>
          </div>
          <div className="topbar-actions">
            <span className="environment-chip">Private</span>
            <LogoutButton />
          </div>
        </header>
        {children}
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <Link href="/dashboard" aria-current={active === "overview" ? "page" : undefined}>
          Home
        </Link>
        <Link href="/automations" aria-current={active === "automations" ? "page" : undefined}>
          Automations
        </Link>
        <Link className="mobile-create" href="/automations#new">
          + Create
        </Link>
        <Link href="/crm" aria-current={active === "crm" ? "page" : undefined}>
          CRM
        </Link>
        <Link href="/settings">More</Link>
      </nav>
    </div>
  );
}
