"use client";

import Link from "next/link";

import { useI18n } from "@/src/lib/i18n/client";

import { roleAllows, type PlatformAdminRole, type PlatformUserRow } from "../contracts";
import { AdminShell } from "./admin-shell";
import { ReasonAction } from "./reason-action";

export function UserDirectory({
  role,
  users,
  maskedEmails,
  query
}: {
  role: PlatformAdminRole;
  users: readonly PlatformUserRow[];
  maskedEmails: Readonly<Record<string, string>>;
  query: string;
}) {
  const { text } = useI18n();
  const canLifecycle = roleAllows(role, "lifecycle");

  return (
    <AdminShell active="users" role={role}>
      <div className="content">
        <section className="panel">
          <form className="crm-filter" action="/admin/users">
            <label className="sr-only" htmlFor="user-query">
              {text("Find an account", "Hesap bul", "یافتن حساب")}
            </label>
            <input
              id="user-query"
              name="email"
              defaultValue={query}
              placeholder={text("Full email address", "Tam e-posta adresi", "نشانی ایمیل کامل")}
            />
            <button className="btn" type="submit">
              {text("Search", "Ara", "جستجو")}
            </button>
          </form>
          <p className="section-note">
            {/*
              Says out loud why the column is masked, so nobody assumes the data
              is missing and goes looking for it somewhere less careful.
            */}
            {text(
              "Addresses are shown masked. Search matches the full address you type; it is never rendered in full.",
              "Adresler maskelenmiş gösterilir. Arama yazdığınız tam adresi eşleştirir; adres hiçbir zaman tam gösterilmez.",
              "نشانی‌ها به‌صورت پوشیده نمایش داده می‌شوند. جستجو با نشانی کاملی که می‌نویسید مطابقت می‌کند و هرگز کامل نمایش داده نمی‌شود."
            )}
          </p>
        </section>

        <section className="panel crm-table-panel">
          {users.length === 0 ? (
            <div className="empty-state">
              <strong>
                {text("No accounts match", "Eşleşen hesap yok", "حسابی مطابقت ندارد")}
              </strong>
            </div>
          ) : (
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>{text("Person", "Kişi", "شخص")}</th>
                  <th>{text("Workspace", "Çalışma alanı", "فضای کاری")}</th>
                  <th>{text("Role", "Rol", "نقش")}</th>
                  <th>{text("Status", "Durum", "وضعیت")}</th>
                  {canLifecycle ? <th>{text("Actions", "İşlemler", "اقدامات")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.userId}>
                    <td>
                      <strong>{user.displayName ?? text("Unnamed", "İsimsiz", "بدون نام")}</strong>
                      <small dir="ltr">{maskedEmails[user.userId] ?? "—"}</small>
                    </td>
                    <td>
                      <Link href={`/admin/workspaces/${user.workspaceId}`}>
                        {user.workspaceName}
                      </Link>
                    </td>
                    <td dir="ltr">{user.role ?? "—"}</td>
                    <td dir="ltr">{user.status}</td>
                    {canLifecycle ? (
                      <td>
                        {user.status === "active" ? (
                          <ReasonAction
                            endpoint="users"
                            body={{ action: "suspend", userId: user.userId }}
                            label={text("Suspend", "Askıya al", "تعلیق")}
                            confirmLabel={text("Confirm suspend", "Askıyı onayla", "تأیید تعلیق")}
                            variant="danger"
                          />
                        ) : (
                          <ReasonAction
                            endpoint="users"
                            body={{ action: "restore", userId: user.userId }}
                            label={text("Restore", "Geri al", "بازگرداندن")}
                          />
                        )}
                        <ReasonAction
                          endpoint="users"
                          body={{ action: "sign_out", userId: user.userId }}
                          label={text("End sessions", "Oturumları bitir", "پایان نشست‌ها")}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
