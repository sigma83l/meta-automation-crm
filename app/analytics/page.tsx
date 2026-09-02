import Link from "next/link";

import { getRequestPreferences } from "@/src/lib/i18n/server";
import { isFeatureEnabled } from "@/src/modules/features/server/gate";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const [{ client, workspace }, { locale, t }] = await Promise.all([
    createMetaRuntime(),
    getRequestPreferences()
  ]);

  // Checked before the six counts run, not after. A page that gathers the
  // numbers and then declines to render them has already done the work and
  // still shows nothing, and the shape of an empty analytics screen is itself
  // information about the workspace.
  if (!(await isFeatureEnabled(client, workspace.id, "analytics"))) {
    const pickOne = (en: string, tr: string, fa: string) =>
      locale === "tr" ? tr : locale === "fa" ? fa : en;
    return (
      <WorkspaceShell active="analytics" workspaceName={workspace.name}>
        <div className="content analytics-content">
          <div className="empty-state">
            <strong>
              {pickOne(
                "Analytics is not part of this plan",
                "Analitik bu plana dahil değil",
                "تحلیل بخشی از این طرح نیست"
              )}
            </strong>
            <p>
              {pickOne(
                "Nothing has been switched off in your workspace — the records are all still there. Talk to us about including it.",
                "Çalışma alanınızda hiçbir şey kapatılmadı — kayıtların tamamı yerinde. Dahil etmek için bizimle görüşün.",
                "چیزی در فضای کاری شما خاموش نشده است — همه رکوردها سر جای خود هستند. برای افزودن آن با ما در تماس باشید."
              )}
            </p>
          </div>
        </div>
      </WorkspaceShell>
    );
  }

  const [conversations, messages, reviews, runs, blocked, customers] = await Promise.all([
    client.from("conversations").select("*", { count: "exact", head: true }),
    client.from("messages").select("*", { count: "exact", head: true }),
    client
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("requires_human_review", true),
    client.from("automation_runs").select("*", { count: "exact", head: true }),
    client
      .from("outbound_attempts")
      .select("*", { count: "exact", head: true })
      .eq("status", "blocked"),
    client.from("customers").select("*", { count: "exact", head: true })
  ]);
  const pick = (en: string, tr: string, fa: string) =>
    locale === "tr" ? tr : locale === "fa" ? fa : en;
  const rows = [
    [
      pick("Conversation volume", "Görüşme hacmi", "حجم گفتگو"),
      conversations.count ?? 0,
      pick(
        "Workspace conversations in the stored dataset",
        "Kayıtlı çalışma alanı görüşmeleri",
        "گفتگوهای ثبت‌شده فضای کاری"
      ),
      "/inbox"
    ],
    [
      pick("Message volume", "Mesaj hacmi", "حجم پیام"),
      messages.count ?? 0,
      pick(
        "Inbound and sandbox outbound message rows",
        "Gelen ve Sandbox giden mesajları",
        "پیام‌های ورودی و خروجی آزمایشی"
      ),
      "/inbox"
    ],
    [
      pick("Human handoffs", "İnsana aktarımlar", "ارجاع به انسان"),
      reviews.count ?? 0,
      pick(
        "Conversations currently requiring a person",
        "Şu anda görevli bekleyen görüşmeler",
        "گفتگوهای نیازمند اپراتور"
      ),
      "/inbox"
    ],
    [
      pick("Automation runs", "Otomasyon çalışmaları", "اجرای اتوماسیون"),
      runs.count ?? 0,
      pick(
        "Durable runs across immutable versions",
        "Değişmez sürümlerdeki dayanıklı çalışmalar",
        "اجراهای پایدار نسخه‌های تغییرناپذیر"
      ),
      "/automations"
    ],
    [
      pick("Blocked attempts", "Engellenen denemeler", "تلاش‌های مسدود"),
      blocked.count ?? 0,
      pick(
        "Outbound attempts denied by policy",
        "Politikanın reddettiği giden denemeler",
        "ارسال‌های ردشده توسط سیاست"
      ),
      "/automations"
    ],
    [
      pick("CRM customers", "CRM müşterileri", "مشتریان CRM"),
      customers.count ?? 0,
      pick(
        "Workspace-scoped customer records",
        "Çalışma alanına ait müşteri kayıtları",
        "مشتریان متعلق به همین فضای کاری"
      ),
      "/crm"
    ]
  ] as const;

  return (
    <WorkspaceShell active="analytics" workspaceName={workspace.name}>
      <div className="content analytics-content">
        <header className="page-intro">
          <span className="eyebrow">{t("nav.analytics")}</span>
          <h2>{t("analytics.title")}</h2>
          <p>{t("analytics.subtitle")}</p>
        </header>
        <section className="metric-grid analytics-grid" aria-label={t("analytics.title")}>
          {rows.map(([label, count, definition, href]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{new Intl.NumberFormat(locale).format(count)}</strong>
              <small>{definition}</small>
              <Link href={href}>
                {pick("View records", "Kayıtları görüntüle", "مشاهده رکوردها")}
              </Link>
            </article>
          ))}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{pick("Definitions", "Tanımlar", "تعریف‌ها")}</span>
              <h2>{pick("Operational evidence", "Operasyon kanıtı", "شواهد عملیاتی")}</h2>
            </div>
          </div>
          <div
            className="analytics-table"
            role="table"
            aria-label={pick("Metric definitions", "Metrik tanımları", "تعریف شاخص‌ها")}
          >
            {rows.map(([label, count, definition]) => (
              <div role="row" key={label}>
                <strong role="cell">{label}</strong>
                <span role="cell">{definition}</span>
                <span role="cell">{new Intl.NumberFormat(locale).format(count)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </WorkspaceShell>
  );
}
