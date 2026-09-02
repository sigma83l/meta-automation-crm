"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useI18n } from "@/src/lib/i18n/client";
import { LogoutButton } from "@/src/modules/auth/ui/logout-button";
import { BrandLockup } from "@/src/modules/workspaces/ui/brand-lockup";
import { PreferenceControls } from "@/src/modules/workspaces/ui/preference-controls";

import { capabilitiesFor, type PlatformAdminRole, type PlatformCapability } from "../contracts";

export type AdminSection =
  "overview" | "workspaces" | "users" | "features" | "system" | "audit" | "staff";

const sections: ReadonlyArray<
  Readonly<{ id: AdminSection; href: string; glyph: string; needs: PlatformCapability }>
> = [
  { id: "overview", href: "/admin", glyph: "PL", needs: "read" },
  { id: "workspaces", href: "/admin/workspaces", glyph: "WS", needs: "read" },
  { id: "users", href: "/admin/users", glyph: "US", needs: "read" },
  { id: "features", href: "/admin/features", glyph: "FF", needs: "read" },
  { id: "system", href: "/admin/system", glyph: "SY", needs: "operations" },
  { id: "audit", href: "/admin/audit", glyph: "AU", needs: "read" },
  { id: "staff", href: "/admin/staff", glyph: "ST", needs: "staff" }
];

/**
 * The console's frame.
 *
 * Deliberately not `WorkspaceShell`. The two shells answer different questions —
 * one is scoped to a single tenant and the other spans all of them — and a
 * reader who cannot tell at a glance which one they are looking at is one click
 * from acting on the wrong workspace. The rail therefore says whose data this
 * is, in every locale, above everything else.
 */
export function AdminShell({
  active,
  role,
  impersonating,
  children
}: {
  active: AdminSection;
  role: PlatformAdminRole;
  /** The workspace this session currently holds a read-only grant on, if any. */
  impersonating?: Readonly<{ workspaceName: string; expiresAt: string }> | null;
  children: ReactNode;
}) {
  const { text } = useI18n();
  const allowed = capabilitiesFor(role);

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
        <BrandLockup context={text("Platform control", "Platform kontrolü", "کنترل پلتفرم")} />
        <div className="workspace-card admin-scope-card">
          <span>{text("Scope", "Kapsam", "دامنه")}</span>
          <strong>{text("All workspaces", "Tüm çalışma alanları", "همه فضاهای کاری")}</strong>
          <small>{roleLabel}</small>
        </div>
        <nav aria-label="Platform navigation">
          {sections
            .filter((section) => allowed.includes(section.needs))
            .map((section) => (
              <Link
                key={section.id}
                href={section.href}
                aria-current={active === section.id ? "page" : undefined}
              >
                <span className="nav-glyph">{section.glyph}</span>
                {label(section.id)}
              </Link>
            ))}
        </nav>
        <div className="safety-lock admin-safety">
          <span className="status-light" />
          <div>
            <strong>{text("Customer data", "Müşteri verisi", "داده مشتری")}</strong>
            <span>
              {text(
                "Every action here is recorded",
                "Buradaki her işlem kaydedilir",
                "هر اقدام در اینجا ثبت می‌شود"
              )}
            </span>
          </div>
        </div>
        <Link className="topbar-link admin-exit" href="/dashboard">
          {text("Back to my workspace", "Çalışma alanıma dön", "بازگشت به فضای کاری من")}
        </Link>
      </aside>
      <main className="workspace-main">
        <header className="topbar">
          <div>
            <span className="eyebrow">
              {text("Platform administration", "Platform yönetimi", "مدیریت پلتفرم")}
            </span>
            <h1>{label(active)}</h1>
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
    </div>
  );
}
