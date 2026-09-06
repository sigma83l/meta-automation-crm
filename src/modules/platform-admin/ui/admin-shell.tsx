"use client";

import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

import { useI18n } from "@/src/lib/i18n/client";
import { LogoutButton } from "@/src/modules/auth/ui/logout-button";
import { BrandLockup } from "@/src/modules/workspaces/ui/brand-lockup";
import { PreferenceControls } from "@/src/modules/workspaces/ui/preference-controls";

import { capabilitiesFor, type PlatformAdminRole, type PlatformCapability } from "../contracts";
import {
  AuditIcon,
  FeaturesIcon,
  PeopleIcon,
  PlatformIcon,
  StaffIcon,
  SystemIcon,
  WorkspacesIcon
} from "./admin-nav-icons";

export type AdminSection =
  "overview" | "workspaces" | "users" | "features" | "system" | "audit" | "staff";

const sections: ReadonlyArray<
  Readonly<{
    id: AdminSection;
    href: string;
    Icon: ComponentType<{ className?: string }>;
    needs: PlatformCapability;
  }>
> = [
  { id: "overview", href: "/admin", Icon: PlatformIcon, needs: "read" },
  { id: "workspaces", href: "/admin/workspaces", Icon: WorkspacesIcon, needs: "read" },
  { id: "users", href: "/admin/users", Icon: PeopleIcon, needs: "read" },
  { id: "features", href: "/admin/features", Icon: FeaturesIcon, needs: "read" },
  { id: "system", href: "/admin/system", Icon: SystemIcon, needs: "operations" },
  { id: "audit", href: "/admin/audit", Icon: AuditIcon, needs: "read" },
  { id: "staff", href: "/admin/staff", Icon: StaffIcon, needs: "staff" }
];

/**
 * The console's frame.
 *
 * Deliberately not `WorkspaceShell`. The two shells answer different questions —
 * one is scoped to a single tenant and the other spans all of them — and a
 * reader who cannot tell at a glance which one they are looking at is one click
 * from acting on the wrong workspace. The rail therefore says whose data this
 * is, in every locale, above everything else.
 *
 * What the rail says and what it merely repeats are different things, and this
 * version keeps only the first. The scope — "All workspaces", and the role
 * holding it — is the sentence that distinguishes this shell from the tenant
 * one, so it stays, as one line rather than a boxed card with a "Scope" caption
 * over it. The standing note that every action is recorded stays too: unlike a
 * chrome badge repeating an environment name, it is a live warning about what
 * the person is about to do, and it is the console's half of the bargain the
 * audit ledger enforces. The word "Platform control" beside the logo went: the
 * line under it already says the scope, and the heading already says the
 * section.
 */
export function AdminShell({
  active,
  role,
  title,
  impersonating,
  children
}: {
  active: AdminSection;
  role: PlatformAdminRole;
  /**
   * What this page is, when that is narrower than the section it belongs to.
   *
   * The heading was derived from `active` alone, so the detail page for one
   * tenant announced itself as "Workspaces" — the section's name, on a screen
   * about a single customer, with the rail already saying the same word. The
   * name of the thing on screen is the heading; `active` still decides which
   * rail entry is current, which is a separate question.
   */
  title?: string;
  /** The workspace this session currently holds a read-only grant on, if any. */
  impersonating?: Readonly<{ workspaceName: string; expiresAt: string }> | null;
  children: ReactNode;
}) {
  const { text } = useI18n();
  const allowed = capabilitiesFor(role);
  const visible = sections.filter((section) => allowed.includes(section.needs));

  const label = (id: AdminSection) => {
    switch (id) {
      case "overview":
        return text("Platform", "Platform", "پلتفرم");
      case "workspaces":
        return text("Workspaces", "Çalışma alanları", "فضاهای کاری");
      case "users":
        return text("People", "Kişiler", "افراد");
      case "features":
        return text("Features", "Özellikler", "قابلیت‌ها");
      case "system":
        return text("System", "Sistem", "سیستم");
      case "audit":
        return text("Audit", "Denetim", "حسابرسی");
      case "staff":
        return text("Staff access", "Personel erişimi", "دسترسی کارکنان");
    }
  };

  const roleLabel =
    role === "platform_owner"
      ? text("Platform owner", "Platform sahibi", "مالک پلتفرم")
      : role === "platform_admin"
        ? text("Platform admin", "Platform yöneticisi", "مدیر پلتفرم")
        : text("Platform support", "Platform destek", "پشتیبانی پلتفرم");

  return (
    <div className="app-shell admin-shell">
      <aside className="control-rail">
        <BrandLockup />
        <div className="admin-scope">
          <strong>{text("All workspaces", "Tüm çalışma alanları", "همه فضاهای کاری")}</strong>
          <span>{roleLabel}</span>
        </div>
        <nav aria-label="Platform navigation">
          {visible.map(({ id, href, Icon }) => (
            <Link key={id} href={href} aria-current={active === id ? "page" : undefined}>
              <span className="nav-glyph">
                <Icon />
              </span>
              {label(id)}
            </Link>
          ))}
        </nav>
        <div className="admin-recorded">
          <span className="status-light" />
          <span>
            {text(
              "Every action here is recorded",
              "Buradaki her işlem kaydedilir",
              "هر اقدام در اینجا ثبت می‌شود"
            )}
          </span>
        </div>
        <Link className="admin-exit" href="/dashboard">
          {text("Back to my workspace", "Çalışma alanıma dön", "بازگشت به فضای کاری من")}
        </Link>
      </aside>
      <main className="workspace-main">
        <header className="topbar">
          <div>
            <h1>{title ?? label(active)}</h1>
          </div>
          <div className="topbar-actions">
            <PreferenceControls compact />
            <LogoutButton />
          </div>
        </header>
        {impersonating ? (
          /**
           * Not dismissible, and rendered above the content rather than beside
           * it. A staff member reading a customer's records should never be one
           * scroll away from forgetting whose records they are.
           */
          <div className="admin-impersonation-banner" role="status">
            <strong>
              {text("Viewing customer data", "Müşteri verisi görüntüleniyor", "مشاهده داده مشتری")}
            </strong>
            <span>
              {impersonating.workspaceName} ·{" "}
              {text("read-only until", "salt okunur, bitiş", "فقط خواندنی تا")}{" "}
              {new Date(impersonating.expiresAt).toLocaleTimeString()}
            </span>
          </div>
        ) : null}
        {children}
      </main>
      {/*
       * The console's own bottom bar.
       *
       * Below 760px the rail becomes a horizontal strip with room for the logo
       * and nothing else, and this shell had no equivalent of the tenant
       * shell's `.mobile-nav` — so on a phone the seven sections were reachable
       * only by typing their URLs. Staff read this console from a phone exactly
       * when something is on fire, which is the worst moment to discover the
       * navigation is missing. Icon and label, same destinations, same
       * capability filter as the rail.
       */}
      <nav className="mobile-nav admin-mobile-nav" aria-label="Platform navigation (compact)">
        {visible.map(({ id, href, Icon }) => (
          <Link key={id} href={href} aria-current={active === id ? "page" : undefined}>
            <Icon />
            <span>{label(id)}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
