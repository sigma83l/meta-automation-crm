"use client";

import Link from "next/link";

import { useI18n } from "@/src/lib/i18n/client";

import type { DeadLetterRow, OutboxHealth, PlatformAdminRole, PlatformSwitch } from "../contracts";
import { AdminShell } from "./admin-shell";
import { ReasonAction } from "./reason-action";

export function SystemPanel({
  role,
  switches,
  deadLetters,
  outbox
}: {
  role: PlatformAdminRole;
  switches: readonly PlatformSwitch[];
  deadLetters: readonly DeadLetterRow[];
  outbox: OutboxHealth;
}) {
  const { text } = useI18n();

  return (
    <AdminShell active="system" role={role}>
      <div className="content">
        <section className="panel">
          <div className="panel-heading">
            <h2>{text("Global switches", "Genel anahtarlar", "کلیدهای سراسری")}</h2>
          </div>
          <div className="warning-box">
            {/*
              Stated on the screen, not only in the migration. Somebody reaching
              for these during an incident needs to know in one sentence which
              direction actually does something.
            */}
            {text(
              "Off stops a capability everywhere, immediately. On only removes this block — the environment gate, approval and allowlist still decide, so nothing here can start a live send.",
              "Kapalı, bir yeteneği her yerde anında durdurur. Açık yalnızca bu engeli kaldırır — ortam kilidi, onay ve izin listesi yine karar verir; buradaki hiçbir şey canlı gönderim başlatamaz.",
              "خاموش، یک قابلیت را فوراً همه‌جا متوقف می‌کند. روشن فقط این مانع را برمی‌دارد — دروازه محیط، تأیید و فهرست مجاز همچنان تصمیم می‌گیرند؛ هیچ‌چیز اینجا نمی‌تواند ارسال زنده را آغاز کند."
            )}
          </div>
          {switches.map((entry) => (
            <div className="settings-card" key={entry.key}>
              <div>
                <strong dir="ltr">{entry.key}</strong>
                <p>{entry.description}</p>
                <small>
                  {text("Changed", "Değiştirildi", "تغییر یافته")}{" "}
                  {new Date(entry.updatedAt).toLocaleString()}
                </small>
              </div>
              <span className={entry.enabled ? "status-pill" : "status-pill status-pill-warning"}>
                {entry.enabled
                  ? text("Permitted", "İzinli", "مجاز")
                  : text("Blocked", "Engelli", "مسدود")}
              </span>
              <ReasonAction
                endpoint="switches"
                body={{ key: entry.key, enabled: !entry.enabled }}
                label={
                  entry.enabled
                    ? text("Block everywhere", "Her yerde engelle", "مسدودسازی همه‌جا")
                    : text("Remove the block", "Engeli kaldır", "برداشتن مسدودی")
                }
                {...(entry.enabled
                  ? {
                      confirmLabel: text("Confirm block", "Engeli onayla", "تأیید مسدودسازی"),
                      variant: "danger" as const
                    }
                  : {})}
              />
            </div>
          ))}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>{text("Delivery queues", "Teslim kuyrukları", "صف‌های تحویل")}</h2>
          </div>
          <div className="metric-grid">
            <div className="summary-card">
              <span className="eyebrow">
                {text("Waiting to relay", "Aktarım bekliyor", "در انتظار انتقال")}
              </span>
              <strong>{outbox.pendingOutbox}</strong>
            </div>
            <div className="summary-card">
              <span className="eyebrow">
                {text("Past retry limit", "Deneme sınırını aştı", "فراتر از حد تلاش")}
              </span>
              <strong>{outbox.exhaustedOutbox}</strong>
              <small>
                {text(
                  "These stop on their own and need a person",
                  "Bunlar kendiliğinden durur ve bir kişi gerektirir",
                  "این‌ها خودبه‌خود متوقف می‌شوند و به رسیدگی نیاز دارند"
                )}
              </small>
            </div>
            <div className="summary-card">
              <span className="eyebrow">
                {text("Unprocessed webhooks", "İşlenmemiş webhook", "وب‌هوک‌های پردازش‌نشده")}
              </span>
              <strong>{outbox.unprocessedWebhooks}</strong>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>{text("Failed automation steps", "Başarısız adımlar", "گام‌های ناموفق")}</h2>
          </div>
          <p className="section-note">
            {text(
              "Clearing one records that a person handled it. It does not re-run the step — a send whose outcome is unknown is never retried blindly.",
              "Birini temizlemek, bir kişinin onu ele aldığını kaydeder. Adımı yeniden çalıştırmaz — sonucu bilinmeyen bir gönderim asla körlemesine yinelenmez.",
              "پاک کردن یکی ثبت می‌کند که فردی به آن رسیدگی کرده است. گام را دوباره اجرا نمی‌کند — ارسالی که نتیجه‌اش نامعلوم است هرگز کورکورانه تکرار نمی‌شود."
            )}
          </p>
          {deadLetters.length === 0 ? (
            <div className="empty-state">
              <strong>{text("Queue is clear", "Kuyruk temiz", "صف خالی است")}</strong>
            </div>
          ) : (
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>{text("Workspace", "Çalışma alanı", "فضای کاری")}</th>
                  <th>{text("Error", "Hata", "خطا")}</th>
                  <th>{text("When", "Zaman", "زمان")}</th>
                  <th>{text("Action", "İşlem", "اقدام")}</th>
                </tr>
              </thead>
              <tbody>
                {deadLetters.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/admin/workspaces/${row.workspaceId}`}>{row.workspaceName}</Link>
                    </td>
                    <td>
                      <strong dir="ltr">{row.errorCode}</strong>
                      <small>{row.safeSummary}</small>
                    </td>
                    <td>{new Date(row.createdAt).toLocaleString()}</td>
                    <td>
                      <ReasonAction
                        endpoint="ops"
                        body={{ action: "acknowledge_dead_letter", id: row.id }}
                        label={text("Mark handled", "Ele alındı", "رسیدگی‌شده")}
                      />
                    </td>
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
