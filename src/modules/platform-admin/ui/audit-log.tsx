"use client";

import Link from "next/link";

import { useI18n } from "@/src/lib/i18n/client";

import type { ImpersonationGrant, PlatformAdminRole, PlatformAuditRow } from "../contracts";
import { AdminShell } from "./admin-shell";

/**
 * What staff have done.
 *
 * The ledger is append-only in the database, so this screen is the whole story
 * and cannot have been tidied. Rendering the raw `action` and the reason side by
 * side is deliberate: the action says what the system did and the reason says
 * what the person thought they were doing, and a review that only ever sees one
 * of the two cannot tell a mistake from a policy call.
 */
export function AuditLog({
  role,
  events,
  grants,
  renderedAt
}: {
  role: PlatformAdminRole;
  events: readonly PlatformAuditRow[];
  grants: readonly ImpersonationGrant[];
  /**
   * The instant the server rendered this, against which a window counts as
   * still open. Passed in rather than read here so the answer is fixed for the
   * whole render — a re-render must not silently reclassify a row as expired
   * halfway down the table.
   */
  renderedAt: string;
}) {
  const { text } = useI18n();
  const now = Date.parse(renderedAt);

  return (
    <AdminShell active="audit" role={role}>
      <div className="content">
        <section className="panel">
          <div className="panel-heading">
            <h2>{text("Customer views", "Müşteri görüntülemeleri", "مشاهده‌های مشتری")}</h2>
          </div>
          {grants.length === 0 ? (
            <div className="empty-state">
              <strong>{text("Nobody has opened one", "Kimse açmadı", "کسی بازش نکرده است")}</strong>
            </div>
          ) : (
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>{text("Workspace", "Çalışma alanı", "فضای کاری")}</th>
                  <th>{text("Reason", "Gerekçe", "دلیل")}</th>
                  <th>{text("Opened", "Açıldı", "باز شد")}</th>
                  <th>{text("State", "Durum", "وضعیت")}</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => {
                  const live = !grant.revokedAt && Date.parse(grant.expiresAt) > now;
                  return (
                    <tr key={grant.id}>
                      <td>
                        <Link href={`/admin/workspaces/${grant.workspaceId}`}>
                          {grant.workspaceName}
                        </Link>
                      </td>
                      <td>{grant.reason}</td>
                      <td>{new Date(grant.createdAt).toLocaleString()}</td>
                      <td>
                        <span className={live ? "status-pill status-pill-warning" : "status-pill"}>
                          {live
                            ? text("Open now", "Şu an açık", "اکنون باز")
                            : grant.revokedAt
                              ? text("Closed", "Kapatıldı", "بسته شد")
                              : text("Expired", "Süresi doldu", "منقضی شد")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel crm-table-panel">
          <div className="panel-heading">
            <h2>{text("Staff actions", "Personel işlemleri", "اقدامات کارکنان")}</h2>
          </div>
          {events.length === 0 ? (
            <div className="empty-state">
              <strong>
                {text("Nothing recorded yet", "Henüz kayıt yok", "هنوز چیزی ثبت نشده")}
              </strong>
            </div>
          ) : (
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>{text("When", "Zaman", "زمان")}</th>
                  <th>{text("Action", "İşlem", "اقدام")}</th>
                  <th>{text("Target", "Hedef", "هدف")}</th>
                  <th>{text("Reason", "Gerekçe", "دلیل")}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.occurredAt).toLocaleString()}</td>
                    <td>
                      <strong dir="ltr">{event.action}</strong>
                      <small dir="ltr">{event.actorRole}</small>
                    </td>
                    <td>
                      {event.targetWorkspaceId ? (
                        <Link href={`/admin/workspaces/${event.targetWorkspaceId}`}>
                          {text("Workspace", "Çalışma alanı", "فضای کاری")}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{String(event.safeDetails.reason ?? "—")}</td>
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
