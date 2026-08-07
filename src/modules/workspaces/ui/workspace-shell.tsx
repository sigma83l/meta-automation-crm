"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { useI18n } from "@/src/lib/i18n/client";
import { LogoutButton } from "@/src/modules/auth/ui/logout-button";
import { BrandLockup } from "@/src/modules/workspaces/ui/brand-lockup";
import { PreferenceControls } from "@/src/modules/workspaces/ui/preference-controls";

export function WorkspaceShell({
  active,
  workspaceName,
  children
}: {
  active: "overview" | "automations" | "crm" | "inbox" | "analytics" | "settings" | "connections";
  workspaceName: string;
  children: ReactNode;
}) {
  const { t, text } = useI18n();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const title =
    active === "overview"
      ? t("nav.overview")
      : active === "automations"
        ? t("nav.automations")
        : active === "crm"
          ? t("nav.crm")
          : active === "inbox"
            ? t("nav.inbox")
            : active === "analytics"
              ? t("nav.analytics")
              : active === "connections"
                ? t("nav.integrations")
                : t("nav.settings");

  return (
    <div className="app-shell">
      <aside className="control-rail">
        <BrandLockup context={t("app.control")} />
        <div className="workspace-card">
          <span>{t("shell.workspace")}</span>
          <strong>{workspaceName}</strong>
          <small>{t("shell.privateTenant")}</small>
        </div>
        <nav aria-label="Main navigation">
          <Link href="/dashboard" aria-current={active === "overview" ? "page" : undefined}>
            <span className="nav-glyph">OV</span>
            {t("nav.overview")}
          </Link>
          <Link href="/inbox" aria-current={active === "inbox" ? "page" : undefined}>
            <span className="nav-glyph">IN</span>
            {t("nav.inbox")}
          </Link>
          <Link href="/automations" aria-current={active === "automations" ? "page" : undefined}>
            <span className="nav-glyph">AU</span>
            {t("nav.automations")}
          </Link>
          <Link href="/crm" aria-current={active === "crm" ? "page" : undefined}>
            <span className="nav-glyph">CR</span>
            {t("nav.crm")}
          </Link>
          <Link href="/analytics" aria-current={active === "analytics" ? "page" : undefined}>
            <span className="nav-glyph">AN</span>
            {t("nav.analytics")}
          </Link>
          <Link href="/connections" aria-current={active === "connections" ? "page" : undefined}>
            <span className="nav-glyph">CX</span>
            {t("nav.integrations")}
          </Link>
          <Link href="/settings" aria-current={active === "settings" ? "page" : undefined}>
            <span className="nav-glyph">SE</span>
            {t("nav.settings")}
          </Link>
        </nav>
        <div className="safety-lock">
          <span className="status-light" />
          <div>
            <strong>{t("shell.safeMode")}</strong>
            <span>{t("shell.noSend")}</span>
          </div>
        </div>
      </aside>
      <main className="workspace-main">
        <header className="topbar">
          <div>
            <span className="eyebrow">{t("shell.workspaceData")}</span>
            <h1>{title}</h1>
          </div>
          <div className="topbar-actions">
            {!online ? (
              <span className="incident-chip" role="status">
                {text(
                  "Offline · changes are not being sent",
                  "Çevrimdışı · değişiklikler gönderilmiyor",
                  "آفلاین · تغییرات ارسال نمی‌شوند"
                )}
              </span>
            ) : null}
            <form className="global-search" action="/crm">
              <label className="sr-only" htmlFor="workspace-search">
                {t("shell.search")}
              </label>
              <input id="workspace-search" name="search" placeholder={t("shell.search")} />
            </form>
            <Link className="topbar-link" href="/dashboard#attention">
              {t("shell.notifications")}
            </Link>
            <PreferenceControls compact />
            <span className="environment-chip">{t("shell.safeMode")}</span>
            <LogoutButton />
          </div>
        </header>
        {children}
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <Link href="/dashboard" aria-current={active === "overview" ? "page" : undefined}>
          {t("nav.home")}
        </Link>
        <Link href="/inbox" aria-current={active === "inbox" ? "page" : undefined}>
          {t("nav.inbox")}
        </Link>
        <Link className="mobile-create" href="/automations#new">
          + {t("nav.create")}
        </Link>
        <Link href="/crm" aria-current={active === "crm" ? "page" : undefined}>
          {t("nav.crm")}
        </Link>
        <Link href="/settings">{t("nav.more")}</Link>
      </nav>
    </div>
  );
}
