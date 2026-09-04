"use client";

import Link from "next/link";

import { useI18n } from "@/src/lib/i18n/client";

import {
  IMPERSONATION_MAX_MINUTES,
  roleAllows,
  type ImpersonationGrant,
  type PlatformAdminRole,
  type WorkspaceDetail
} from "../contracts";
import { AdminShell } from "./admin-shell";
import { ReasonAction } from "./reason-action";

export type PlanOption = Readonly<{ id: string; planKey: string; displayName: string }>;

export function WorkspaceDetailPanel({
  role,
  detail,
  plans,
  maskedEmails,
  grant
}: {
  role: PlatformAdminRole;
  detail: WorkspaceDetail;
  plans: readonly PlanOption[];
  maskedEmails: Readonly<Record<string, string>>;
  grant: ImpersonationGrant | null;
}) {
  const { text } = useI18n();
  const { workspace } = detail;
  const canLifecycle = roleAllows(role, "lifecycle");
  const canBilling = roleAllows(role, "billing");
  const canFeatures = roleAllows(role, "features");
  const canImpersonate = roleAllows(role, "impersonate");

  return (
    <AdminShell
      active="workspaces"
      role={role}
      title={workspace.name}
      impersonating={grant ? { workspaceName: workspace.name, expiresAt: grant.expiresAt } : null}
    >
      <div className="content">
        <Link className="back-link" href="/admin/workspaces">
          {text("All workspaces", "Tüm çalışma alanları", "همه فضاهای کاری")}
        </Link>

        <section className="panel">
          <div className="panel-heading">
            <h2>{workspace.name}</h2>
            <span className="status-pill" dir="ltr">
              {workspace.status}
            </span>
          </div>
          <div className="metric-grid">
            <div className="summary-card">
              <span className="eyebrow">{text("Contacts", "Kişiler", "مخاطبان")}</span>
              <strong>{detail.usage.customers}</strong>
            </div>
            <div className="summary-card">
              <span className="eyebrow">{text("Conversations", "Konuşmalar", "گفتگوها")}</span>
              <strong>{detail.usage.conversations}</strong>
            </div>
            <div className="summary-card">
              <span className="eyebrow">{text("Automations", "Otomasyonlar", "اتوماسیون‌ها")}</span>
              <strong>{detail.usage.automations}</strong>
            </div>
            <div className="summary-card">
              <span className="eyebrow">
                {text("Failed steps", "Başarısız adımlar", "گام‌های ناموفق")}
              </span>
              <strong>{detail.usage.unrecoveredDeadLetters}</strong>
            </div>
          </div>
        </section>

        {canImpersonate ? (
          <section className="panel">
            <div className="panel-heading">
              <h2>{text("View customer data", "Müşteri verisini gör", "مشاهده داده مشتری")}</h2>
            </div>
            <p className="section-note">
              {text(
                `Opens a read-only window of up to ${IMPERSONATION_MAX_MINUTES} minutes. It is recorded, it expires on its own, and no write path in the product consults it.`,
                `En fazla ${IMPERSONATION_MAX_MINUTES} dakikalık salt okunur bir pencere açar. Kaydedilir, kendiliğinden sona erer ve üründeki hiçbir yazma yolu onu dikkate almaz.`,
                `پنجره‌ای فقط خواندنی تا ${IMPERSONATION_MAX_MINUTES} دقیقه باز می‌کند. ثبت می‌شود، خودبه‌خود منقضی می‌شود و هیچ مسیر نوشتنی در محصول به آن رجوع نمی‌کند.`
              )}
            </p>
            {grant ? (
              <ReasonAction
                endpoint="impersonation"
                body={{ action: "close", workspaceId: workspace.id }}
                label={text("Close the view", "Görüntülemeyi kapat", "بستن مشاهده")}
              />
            ) : (
              <ReasonAction
                endpoint="impersonation"
                body={{ action: "open", workspaceId: workspace.id }}
                label={text("Open read-only view", "Salt okunur aç", "باز کردن فقط خواندنی")}
                fields={[
                  {
                    key: "minutes",
                    kind: "number",
                    label: text("Minutes", "Dakika", "دقیقه"),
                    defaultValue: "15",
                    min: 1,
                    max: IMPERSONATION_MAX_MINUTES
                  }
                ]}
              />
            )}
          </section>
        ) : null}

        {canLifecycle ? (
          <section className="panel">
            <div className="panel-heading">
              <h2>{text("Access", "Erişim", "دسترسی")}</h2>
            </div>
            <p className="section-note">
              {text(
                "Suspending withdraws access for everyone in this workspace. Nothing is deleted and it can be undone here.",
                "Askıya alma, bu çalışma alanındaki herkesin erişimini kaldırır. Hiçbir şey silinmez ve buradan geri alınabilir.",
                "تعلیق دسترسی همه اعضای این فضای کاری را برمی‌دارد. چیزی حذف نمی‌شود و از همین‌جا برگشت‌پذیر است."
              )}
            </p>
            {workspace.status === "active" ? (
              <ReasonAction
                endpoint="workspaces"
                body={{ workspaceId: workspace.id, status: "disabled" }}
                label={text("Suspend workspace", "Çalışma alanını askıya al", "تعلیق فضای کاری")}
                confirmLabel={text("Confirm suspend", "Askıya almayı onayla", "تأیید تعلیق")}
                variant="danger"
              />
            ) : (
              <ReasonAction
                endpoint="workspaces"
                body={{ workspaceId: workspace.id, status: "active" }}
                label={text("Restore workspace", "Çalışma alanını geri al", "بازگرداندن فضای کاری")}
              />
            )}
          </section>
        ) : null}

        {canBilling ? (
          <section className="panel">
            <div className="panel-heading">
              <h2>{text("Subscription", "Abonelik", "اشتراک")}</h2>
              <span dir="ltr">
                {workspace.subscriptionStatus ?? "—"}
                {workspace.planKey ? ` · ${workspace.planKey}` : ""}
              </span>
            </div>
            <p className="section-note">
              {text(
                "A workspace gets one trial ever. An extension moves that trial's deadline; it cannot grant a second one.",
                "Bir çalışma alanı ömründe tek deneme alır. Uzatma bu denemenin bitişini öteler; ikinci bir deneme veremez.",
                "هر فضای کاری فقط یک دوره آزمایشی دارد. تمدید مهلت همان دوره را جابه‌جا می‌کند و دوره دوم نمی‌دهد."
              )}
            </p>
            <div className="admin-action-row">
              <ReasonAction
                endpoint="billing"
                body={{ action: "extend_trial", workspaceId: workspace.id }}
                label={text("Extend trial", "Denemeyi uzat", "تمدید دوره آزمایشی")}
                fields={[
                  {
                    key: "days",
                    kind: "number",
                    label: text("Days", "Gün", "روز"),
                    defaultValue: "7",
                    min: 1,
                    max: 90
                  }
                ]}
              />
              <ReasonAction
                endpoint="billing"
                body={{ action: "set_status", workspaceId: workspace.id }}
                label={text("Set status", "Durumu ayarla", "تنظیم وضعیت")}
                fields={[
                  {
                    key: "status",
                    kind: "select",
                    label: text("Status", "Durum", "وضعیت"),
                    defaultValue: "active",
                    options: [
                      { value: "active", label: "active" },
                      { value: "past_due", label: "past_due" },
                      { value: "suspended", label: "suspended" },
                      { value: "canceled", label: "canceled" }
                    ]
                  }
                ]}
              />
              {plans.length > 0 ? (
                <ReasonAction
                  endpoint="billing"
                  body={{ action: "set_plan", workspaceId: workspace.id }}
                  label={text("Move to plan", "Plana taşı", "انتقال به طرح")}
                  fields={[
                    {
                      key: "planId",
                      kind: "select",
                      label: text("Plan", "Plan", "طرح"),
                      defaultValue: plans[0]!.id,
                      options: plans.map((plan) => ({ value: plan.id, label: plan.displayName }))
                    }
                  ]}
                />
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="panel crm-table-panel">
          <div className="panel-heading">
            <h2>{text("Features", "Özellikler", "قابلیت‌ها")}</h2>
          </div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>{text("Feature", "Özellik", "قابلیت")}</th>
                <th>{text("State", "Durum", "وضعیت")}</th>
                <th>{text("Decided by", "Karar kaynağı", "تعیین‌شده توسط")}</th>
                {canFeatures ? <th>{text("Change", "Değiştir", "تغییر")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {detail.flags.map((flag) => (
                <tr key={flag.key}>
                  <td>
                    <strong>{flag.displayName}</strong>
                    <small>{flag.description}</small>
                  </td>
                  <td>
                    <span
                      className={flag.enabled ? "status-pill" : "status-pill status-pill-warning"}
                    >
                      {flag.enabled ? text("On", "Açık", "روشن") : text("Off", "Kapalı", "خاموش")}
                    </span>
                  </td>
                  <td>
                    <span dir="ltr">{flag.source}</span>
                    {flag.overrideReason ? <small>{flag.overrideReason}</small> : null}
                  </td>
                  {canFeatures ? (
                    <td className="admin-actions-cell">
                      <ReasonAction
                        endpoint="features"
                        body={{
                          action: "set_override",
                          workspaceId: workspace.id,
                          flagKey: flag.key,
                          enabled: !flag.enabled
                        }}
                        label={
                          flag.enabled
                            ? text("Turn off", "Kapat", "خاموش کن")
                            : text("Turn on", "Aç", "روشن کن")
                        }
                      />
                      {flag.source === "override" ? (
                        <ReasonAction
                          endpoint="features"
                          body={{
                            action: "clear_override",
                            workspaceId: workspace.id,
                            flagKey: flag.key
                          }}
                          label={text("Use plan default", "Plan varsayılanı", "پیش‌فرض طرح")}
                        />
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel crm-table-panel">
          <div className="panel-heading">
            <h2>{text("People", "Kişiler", "افراد")}</h2>
          </div>
          {/*
            An empty table renders as four headings over nothing, which reads as
            a failed query rather than as a workspace with nobody in it. Every
            other table in the console guards this; this one did not.
          */}
          {detail.members.length === 0 ? (
            <div className="empty-state">
              <strong>{text("Nobody here yet", "Henüz kimse yok", "هنوز کسی نیست")}</strong>
            </div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{text("Person", "Kişi", "شخص")}</th>
                  <th>{text("Role", "Rol", "نقش")}</th>
                  <th>{text("Status", "Durum", "وضعیت")}</th>
                  {canLifecycle ? <th>{text("Actions", "İşlemler", "اقدامات")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {detail.members.map((member) => (
                  <tr key={member.userId}>
                    <td>
                      <strong>
                        {member.displayName ?? text("Unnamed", "İsimsiz", "بدون نام")}
                      </strong>
                      <small dir="ltr">{maskedEmails[member.userId] ?? "—"}</small>
                    </td>
                    <td dir="ltr">{member.role ?? "—"}</td>
                    <td dir="ltr">{member.status}</td>
                    {canLifecycle ? (
                      <td>
                        <ReasonAction
                          endpoint="users"
                          body={{
                            action: "set_role",
                            workspaceId: workspace.id,
                            userId: member.userId
                          }}
                          label={text("Set role", "Rolü ayarla", "تنظیم نقش")}
                          fields={[
                            {
                              key: "role",
                              kind: "select",
                              label: text("Role", "Rol", "نقش"),
                              defaultValue: member.role ?? "viewer",
                              options: [
                                { value: "owner", label: "owner" },
                                { value: "admin", label: "admin" },
                                { value: "operator", label: "operator" },
                                { value: "viewer", label: "viewer" }
                              ]
                            }
                          ]}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>
              {text("Recent staff actions", "Son personel işlemleri", "اقدامات اخیر کارکنان")}
            </h2>
          </div>
          {detail.recentAudit.length === 0 ? (
            <p className="section-note">
              {text(
                "Nothing has been done to this workspace from the console.",
                "Konsoldan bu çalışma alanına hiçbir işlem yapılmadı.",
                "از کنسول هیچ اقدامی روی این فضای کاری انجام نشده است."
              )}
            </p>
          ) : (
            <ul className="activity-list">
              {detail.recentAudit.map((event) => (
                <li key={event.id}>
                  <strong className="admin-key" dir="ltr">
                    {event.action}
                  </strong>
                  <span>{String(event.safeDetails.reason ?? "")}</span>
                  <small>
                    <time dateTime={event.occurredAt}>
                      {new Date(event.occurredAt).toLocaleString()}
                    </time>
                  </small>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
