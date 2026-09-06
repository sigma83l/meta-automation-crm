import Link from "next/link";
import { notFound } from "next/navigation";

import { getRequestPreferences } from "@/src/lib/i18n/server";
import { AUTOMATION_TABS, resolveTab } from "@/src/modules/automations/detail-tabs";
import { loadAutomationDetail } from "@/src/modules/automations/server/detail";
import { AutomationActions } from "@/src/modules/automations/ui/automation-builder";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";
import { BillingEntitlementError } from "@/src/modules/billing/entitlement-gate";
import { EntitlementBlocked } from "@/src/modules/billing/ui/entitlement-blocked";

export const dynamic = "force-dynamic";

/**
 * Tabs are links with a `?tab=` query, not client state and not `#hash`
 * anchors.
 *
 * A hash is what this page used to do, and it could not work: there was one
 * panel, so every tab scrolled to nothing and Overview stayed selected. A query
 * parameter is server-rendered, which means each tab is a real URL an operator
 * can bookmark or send to somebody, it selects correctly before any JavaScript
 * runs, and `aria-current` describes what is actually on screen.
 */

function when(value: string, locale: string) {
  return new Date(value).toLocaleString(locale === "en" ? "en-GB" : locale);
}

export default async function AutomationDetail({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getRequestPreferences();
  let workspace: Awaited<ReturnType<typeof createMetaRuntime>>["workspace"];
  try {
    ({ workspace } = await createMetaRuntime());
  } catch (error) {
    if (error instanceof BillingEntitlementError) {
      return (
        <WorkspaceShell active="automations" workspaceName={error.workspace.name}>
          <div className="content">
            <EntitlementBlocked locale={locale} status={error.status} />
          </div>
        </WorkspaceShell>
      );
    }
    throw error;
  }

  const id = (await params).id;
  const tab = resolveTab((await searchParams).tab);
  const detail = await loadAutomationDetail(workspace, id, tab);
  if (!detail) notFound();
  const { automation } = detail;

  const pick = (en: string, tr: string, fa: string) =>
    locale === "tr" ? tr : locale === "fa" ? fa : en;

  const empty = (message: string) => <p role="status">{message}</p>;

  return (
    <WorkspaceShell active="automations" workspaceName={workspace.name}>
      <div className="content">
        <section className="customer-hero">
          <span className="eyebrow">{automation.recipe.replaceAll("_", " ")}</span>
          <h2>{automation.name}</h2>
          <p>Status: {automation.status}</p>
        </section>

        <nav className="detail-tabs" aria-label="Automation detail">
          {AUTOMATION_TABS.map((entry) => (
            <Link
              key={entry.id}
              href={`/automations/${id}?tab=${entry.id}`}
              aria-current={entry.id === tab ? "page" : undefined}
            >
              {entry.label}
            </Link>
          ))}
        </nav>

        {tab === "overview" && detail.overview && (
          <section className="detail-panel">
            <h2>{pick("Overview", "Genel bakış", "نمای کلی")}</h2>
            <p>
              {pick(
                "Every send rechecks workspace, connection, consent, window, confidence and takeover policy.",
                "Her gönderim çalışma alanı, bağlantı, onay, pencere, güven ve devralma politikasını yeniden denetler.",
                "هر ارسال، فضای کاری، اتصال، رضایت، پنجره، اطمینان و سیاست واگذاری را دوباره بررسی می‌کند."
              )}
            </p>
            {workspace.role === "viewer" ? (
              <p role="status">
                {pick(
                  "Viewer access is read-only.",
                  "Görüntüleyici erişimi salt okunurdur.",
                  "دسترسی بیننده فقط خواندنی است."
                )}
              </p>
            ) : (
              <AutomationActions id={id} status={automation.status} />
            )}
            <div className="state-grid">
              <article>
                <strong>{pick("Active version", "Etkin sürüm", "نسخه فعال")}</strong>
                <span>
                  {detail.overview.activeVersion
                    ? `v${detail.overview.activeVersion.version} · ${when(detail.overview.activeVersion.createdAt, locale)}`
                    : pick(
                        "No published version",
                        "Yayınlanmış sürüm yok",
                        "نسخه منتشرشده‌ای نیست"
                      )}
                </span>
              </article>
              <article>
                <strong>{pick("Last failure", "Son hata", "آخرین خطا")}</strong>
                <span>
                  {detail.overview.lastFailure
                    ? `${detail.overview.lastFailure.errorCode} · ${when(detail.overview.lastFailure.createdAt, locale)}`
                    : pick("No recorded failure", "Kayıtlı hata yok", "خطای ثبت‌شده‌ای نیست")}
                </span>
              </article>
              <article>
                <strong>{pick("Queued steps", "Kuyruktaki adımlar", "گام‌های در صف")}</strong>
                <span>
                  {detail.overview.queuedSteps} {pick("pending", "bekliyor", "در انتظار")}
                </span>
              </article>
            </div>
          </section>
        )}

        {tab === "runs" && detail.runs && (
          <section className="detail-panel">
            <h2>{pick("Runs", "Çalışmalar", "اجراها")}</h2>
            {detail.runs.runs.length === 0 ? (
              empty(
                pick(
                  "No runs yet. A run is created when a real message reaches this automation — a safe test in the Test Center does not create one, by design.",
                  "Henüz çalışma yok. Bu otomasyona gerçek bir mesaj ulaştığında bir çalışma oluşur; Test Merkezi'ndeki güvenli test tasarım gereği çalışma oluşturmaz.",
                  "هنوز اجرایی نیست. با رسیدن پیام واقعی به این اتوماسیون یک اجرا ساخته می‌شود؛ آزمون امن در مرکز آزمون عمداً اجرا نمی‌سازد."
                )
              )
            ) : (
              <table className="run-table">
                <thead>
                  <tr>
                    <th>{pick("State", "Durum", "وضعیت")}</th>
                    <th>{pick("Conversation", "Görüşme", "گفت‌وگو")}</th>
                    <th>{pick("Failure", "Hata", "خطا")}</th>
                    <th>{pick("Updated", "Güncellendi", "به‌روزرسانی")}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.runs.runs.map((run) => (
                    <tr key={run.id}>
                      <td>
                        {run.state}
                        {run.humanPaused ? ` · ${pick("paused", "duraklatıldı", "متوقف")}` : ""}
                      </td>
                      <td>
                        <Link href={`/inbox?conversation=${run.conversationId}`}>
                          {run.conversationId.slice(0, 8)}
                        </Link>
                      </td>
                      <td>{run.failureCode ?? "—"}</td>
                      <td>{when(run.updatedAt, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <h3>{pick("Activity", "Etkinlik", "فعالیت")}</h3>
            {detail.runs.activity.length === 0 ? (
              empty(
                pick(
                  "Nothing has been done to this automation yet.",
                  "Bu otomasyona henüz bir işlem yapılmadı.",
                  "هنوز کاری روی این اتوماسیون انجام نشده است."
                )
              )
            ) : (
              <ul className="activity-list">
                {detail.runs.activity.map((entry) => (
                  <li key={entry.id}>
                    <code>{entry.eventType}</code>
                    <span>{when(entry.createdAt, locale)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === "versions" && detail.versions && (
          <section className="detail-panel">
            <h2>{pick("Versions", "Sürümler", "نسخه‌ها")}</h2>
            <p>
              {pick(
                "A published version is immutable. Changing the automation creates the next one.",
                "Yayınlanan bir sürüm değiştirilemez. Otomasyonu değiştirmek bir sonrakini oluşturur.",
                "نسخه منتشرشده تغییرناپذیر است. تغییر اتوماسیون، نسخه بعدی را می‌سازد."
              )}
            </p>
            {detail.versions.length === 0 ? (
              empty(pick("No versions.", "Sürüm yok.", "نسخه‌ای نیست."))
            ) : (
              <ul className="version-list">
                {detail.versions.map((version) => (
                  <li key={version.id}>
                    <strong>v{version.version}</strong>
                    {version.isActive && (
                      <span className="status-pill">{pick("Active", "Etkin", "فعال")}</span>
                    )}
                    <span>{when(version.createdAt, locale)}</span>
                    <code>{version.contentHash.slice(0, 12)}</code>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === "analytics" && detail.analytics && (
          <section className="detail-panel">
            <h2>{pick("Analytics", "Analitik", "تحلیل")}</h2>
            <div className="state-grid">
              <article>
                <strong>{pick("Runs", "Çalışmalar", "اجراها")}</strong>
                <span>
                  {detail.analytics.runsByState.length === 0
                    ? pick("None", "Yok", "هیچ")
                    : detail.analytics.runsByState
                        .map((entry) => `${entry.state}: ${entry.count}`)
                        .join(" · ")}
                </span>
              </article>
              <article>
                <strong>{pick("Outbound attempts", "Giden denemeler", "تلاش‌های خروجی")}</strong>
                <span>
                  {detail.analytics.attemptsByStatus.length === 0
                    ? pick("None", "Yok", "هیچ")
                    : detail.analytics.attemptsByStatus
                        .map((entry) => `${entry.status}: ${entry.count}`)
                        .join(" · ")}
                </span>
              </article>
              <article>
                <strong>{pick("Dead letters", "Ölü mektuplar", "نامه‌های مرده")}</strong>
                <span>{detail.analytics.deadLetters}</span>
              </article>
              <article>
                <strong>{pick("Operator actions", "Operatör işlemleri", "اقدامات اپراتور")}</strong>
                <span>{detail.analytics.actionsTaken}</span>
              </article>
            </div>
            <p>
              <Link href="/analytics">
                {pick(
                  "Workspace-wide analytics",
                  "Çalışma alanı geneli analitik",
                  "تحلیل کل فضای کاری"
                )}
              </Link>
            </p>
          </section>
        )}

        {tab === "settings" && detail.settings && (
          <section className="detail-panel">
            <h2>{pick("Settings", "Ayarlar", "تنظیمات")}</h2>
            {detail.settings.version === undefined ? (
              empty(
                pick(
                  "This automation has no published version to describe.",
                  "Bu otomasyonun açıklanacak yayınlanmış bir sürümü yok.",
                  "این اتوماسیون نسخه منتشرشده‌ای برای توصیف ندارد."
                )
              )
            ) : (
              <>
                <p>
                  {pick("Published as", "Şu sürümle yayınlandı", "منتشرشده به‌عنوان")} v
                  {detail.settings.version}.{" "}
                  {pick(
                    "These values are frozen. Create a new version to change them.",
                    "Bu değerler donduruldu. Değiştirmek için yeni bir sürüm oluşturun.",
                    "این مقادیر ثابت‌اند. برای تغییر، نسخه جدیدی بسازید."
                  )}
                </p>
                <dl className="settings-list">
                  {Object.entries(detail.settings.configuration ?? {}).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{Array.isArray(value) ? value.join(", ") : String(value)}</dd>
                    </div>
                  ))}
                </dl>
                <h3>{pick("Questions asked", "Sorulan sorular", "پرسش‌های مطرح‌شده")}</h3>
                {detail.settings.questions.length === 0 ? (
                  empty(pick("None.", "Yok.", "هیچ."))
                ) : (
                  <ol className="question-list">
                    {detail.settings.questions.map((question) => (
                      <li key={question.fieldKey}>
                        <span>{question.prompt}</span>
                        {question.required && (
                          <span className="status-pill">
                            {pick("Required", "Zorunlu", "الزامی")}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
