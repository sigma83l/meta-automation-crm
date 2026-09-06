"use client";

import Link from "next/link";

import { useI18n } from "@/src/lib/i18n/client";

import type { PlatformAdminRole, WorkspaceRow } from "../contracts";
import { AdminShell } from "./admin-shell";

export function WorkspaceDirectory({
  role,
  workspaces,
  query,
  status
}: {
  role: PlatformAdminRole;
  workspaces: readonly WorkspaceRow[];
  query: string;
  status: string;
}) {
  const { text } = useI18n();

  return (
    <AdminShell active="workspaces" role={role}>
      <div className="content">
        <section className="panel">
          <form className="crm-filter" action="/admin/workspaces">
            <label className="sr-only" htmlFor="workspace-query">
              {text("Search workspaces", "Çalışma alanı ara", "جستجوی فضای کاری")}
            </label>
            <input
              id="workspace-query"
              name="q"
              defaultValue={query}
              placeholder={text("Search by name", "Ada göre ara", "جستجو با نام")}
            />
            <label className="sr-only" htmlFor="workspace-status">
              {text("Status", "Durum", "وضعیت")}
            </label>
            <select id="workspace-status" name="status" defaultValue={status}>
              <option value="">{text("All", "Tümü", "همه")}</option>
              <option value="active">{text("Active", "Etkin", "فعال")}</option>
              <option value="disabled">{text("Suspended", "Askıda", "معلق")}</option>
            </select>
            <button className="btn" type="submit">
              {text("Filter", "Filtrele", "فیلتر")}
            </button>
          </form>
        </section>

        <section className="panel crm-table-panel">
          {workspaces.length === 0 ? (
            <div className="empty-state">
              <strong>
                {text("No workspaces match", "Eşleşen çalışma alanı yok", "فضای کاری مطابقی نیست")}
              </strong>
              <p>
                {text("Change the filters.", "Filtreleri değiştirin.", "فیلترها را تغییر دهید.")}
              </p>
            </div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{text("Workspace", "Çalışma alanı", "فضای کاری")}</th>
                  <th>{text("Status", "Durum", "وضعیت")}</th>
                  <th>{text("People", "Kişiler", "افراد")}</th>
                  <th>{text("Subscription", "Abonelik", "اشتراک")}</th>
                  <th>{text("Created", "Oluşturuldu", "ایجاد شده")}</th>
                </tr>
              </thead>
              <tbody>
                {workspaces.map((workspace) => (
                  <tr key={workspace.id}>
                    <td>
                      <Link href={`/admin/workspaces/${workspace.id}`}>{workspace.name}</Link>
                    </td>
                    <td>
                      <span
                        className={
                          workspace.status === "active"
                            ? "status-pill"
                            : "status-pill status-pill-warning"
                        }
                      >
                        {workspace.status === "active"
                          ? text("Active", "Etkin", "فعال")
                          : text("Suspended", "Askıda", "معلق")}
                      </span>
                    </td>
                    <td>{workspace.memberCount}</td>
                    <td>
                      {/*
                        Machine identifiers stay bidi-isolated: a plan key or a
                        status word rendered inside a Persian sentence would
                        otherwise reorder around the surrounding text.
                      */}
                      <span dir="ltr">
                        {workspace.subscriptionStatus ?? "—"}
                        {workspace.planKey ? ` · ${workspace.planKey}` : ""}
                      </span>
                    </td>
                    <td>{new Date(workspace.createdAt).toLocaleDateString()}</td>
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
