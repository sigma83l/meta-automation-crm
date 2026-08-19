"use client";

import Link from "next/link";
import { useI18n } from "@/src/lib/i18n/client";
import type { WorkspaceOverview } from "../contracts";
import { WorkspaceShell } from "./workspace-shell";
export function DashboardOverview({
  workspaceName,
  overview,
  metrics
}: {
  workspaceName: string;
  /** Null when the read model could not be read. Not the same as all zeroes. */
  overview: WorkspaceOverview | null;
  metrics: {
    automations: number;
    windows: number;
    customers: number;
    errors: number;
    whatsapp: string;
    instagram: string;
  };
}) {
  const { t, text } = useI18n();
  /**
   * An em dash when the overview is unavailable.
   *
   * Showing 0 there would claim the queue is empty on the strength of a query
   * that failed, which is the only reading of this panel that could send
   * somebody home with work outstanding.
   */
  const count = (value: number | undefined) => (overview ? String(value) : "—");
  const checklist: ReadonlyArray<readonly [string, string]> = [
    [text("Business profile", "İşletme profili", "پروفایل کسب‌وکار"), "/settings"],
    [text("Brand, pricing and FAQs", "Marka, fiyat ve SSS", "برند، قیمت و پرسش‌ها"), "/settings"],
    [text("AI provider", "Yapay zekâ sağlayıcısı", "ارائه‌دهنده هوش مصنوعی"), "/settings"],
    [text("Connect channels", "Kanalları bağla", "اتصال کانال‌ها"), "/connections"],
    [
      text("Create first automation", "İlk otomasyonu oluştur", "ساخت اولین اتوماسیون"),
      "/automations"
    ]
  ];
  return (
    <WorkspaceShell active="overview" workspaceName={workspaceName}>
      <div className="content">
        <section className="control-brief">
          <div className="brief-copy">
            <span className="eyebrow">
              {text("Next safe action", "Sonraki güvenli adım", "اقدام امن بعدی")}
            </span>
            <h2>
              {text(
                "Turn one inbound conversation into a complete customer record.",
                "Bir gelen konuşmayı eksiksiz müşteri kaydına dönüştürün.",
                "یک گفتگوی ورودی را به پرونده کامل مشتری تبدیل کنید."
              )}
            </h2>
            <p>
              {text(
                "Finish setup, run a Sandbox test, and activate only when every policy check is ready.",
                "Kurulumu tamamlayın، Sandbox testi çalıştırın ve yalnızca tüm kontroller hazırken etkinleştirin.",
                "راه‌اندازی را کامل کنید، آزمایش Sandbox را اجرا کنید و فقط پس از آمادگی همه سیاست‌ها فعال کنید."
              )}
            </p>
            <Link className="primary-link" href="/automations">
              {t("automations.create")}
            </Link>
          </div>
          <div className="signal-lanes" aria-label="Connection health">
            <div className="signal-lane signal-lane-whatsapp">
              <span>WhatsApp</span>
              <strong>{metrics.whatsapp}</strong>
            </div>
            <div className="signal-lane signal-lane-instagram">
              <span>Instagram</span>
              <strong>{metrics.instagram}</strong>
            </div>
            <div className="signal-lock">
              <span aria-hidden>×</span>
              {text("Live sends are locked", "Canlı gönderimler kilitli", "ارسال زنده قفل است")}
            </div>
          </div>
        </section>
        {/*
          The four counts that mean somebody has to do something. Totals that
          merely describe the workspace moved below them: both were competing
          for the same row before, and a customer count never once told anyone
          what to do next.
        */}
        <section className="metric-grid" aria-label="Work waiting on a person">
          <article>
            <span>{text("Awaiting human", "İnsan bekliyor", "در انتظار اپراتور")}</span>
            <strong>{count(overview?.conversationsAwaitingHuman)}</strong>
            <small>
              <Link href="/inbox">
                {text("Open the inbox", "Gelen kutusunu aç", "باز کردن صندوق ورودی")}
              </Link>
            </small>
          </article>
          <article>
            <span>{text("Handoffs open", "Açık devirler", "تحویل‌های باز")}</span>
            <strong>{count(overview?.handoffsOpen)}</strong>
            <small>
              {text("Not yet acknowledged", "Henüz teslim alınmadı", "هنوز تأیید نشده")}
            </small>
          </article>
          <article>
            <span>{text("Follow-ups due", "Vadesi gelen takipler", "پیگیری‌های سررسید")}</span>
            <strong>{count(overview?.followupsDue)}</strong>
            <small>{text("Eligible to send", "Göndermeye uygun", "واجد شرایط ارسال")}</small>
          </article>
          <article>
            <span>
              {text("Connections at risk", "Riskli bağlantılar", "اتصال‌های در معرض خطر")}
            </span>
            <strong>{count(overview?.connectionsNeedingAttention)}</strong>
            <small>
              <Link href="/connections">
                {text("Review connections", "Bağlantıları incele", "بررسی اتصال‌ها")}
              </Link>
            </small>
          </article>
        </section>
        {overview ? null : (
          <p className="metric-unavailable" role="status">
            {text(
              "These counts could not be read just now. They are not zero — retry shortly.",
              "Bu sayılar şu anda okunamadı. Sıfır değiller — birazdan yeniden deneyin.",
              "این شمارش‌ها اکنون خوانده نشد. مقدارشان صفر نیست — کمی بعد دوباره تلاش کنید."
            )}
          </p>
        )}
        <ul className="metric-totals" aria-label="Workspace totals">
          <li>
            <span>{text("Active automations", "Etkin otomasyonlar", "اتوماسیون‌های فعال")}</span>
            <strong>{metrics.automations}</strong>
          </li>
          <li>
            <span>
              {text("Open service windows", "Açık hizmet pencereleri", "پنجره‌های باز گفتگو")}
            </span>
            <strong>{metrics.windows}</strong>
          </li>
          <li>
            <span>{text("Customer records", "Müşteri kayıtları", "رکوردهای مشتری")}</span>
            <strong>{metrics.customers}</strong>
          </li>
        </ul>
        <div className="dashboard-grid">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">{t("overview.readiness")}</span>
                <h2>{text("Launch checklist", "Başlatma listesi", "فهرست آمادگی")}</h2>
              </div>
              <span>{text("Resumable", "Devam edilebilir", "قابل ادامه")}</span>
            </div>
            <div className="setup-list">
              {checklist.map(([label, href], index) => (
                <article key={label}>
                  <span className="step">{index + 1}</span>
                  <div>
                    <strong>{label}</strong>
                    <span>
                      {index < 2
                        ? text("Review details", "Ayrıntıları inceleyin", "مرور جزئیات")
                        : text("Action required", "İşlem gerekli", "نیازمند اقدام")}
                    </span>
                  </div>
                  <Link href={href}>{t("common.open")}</Link>
                </article>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">{t("overview.activity")}</span>
                <h2>{t("overview.attention")}</h2>
              </div>
              <span>Sandbox</span>
            </div>
            <div className="activity-list">
              <article>
                <span className="channel-badge">HR</span>
                <div>
                  <strong>
                    {text("Human-review queue", "İnsan inceleme kuyruğu", "صف بررسی انسانی")}
                  </strong>
                  <span>
                    {text(
                      `${count(overview?.conversationsAwaitingHuman)} conversations waiting`,
                      `${count(overview?.conversationsAwaitingHuman)} görüşme bekliyor`,
                      `${count(overview?.conversationsAwaitingHuman)} گفتگو در انتظار است`
                    )}
                  </span>
                </div>
              </article>
              <article>
                <span className="channel-badge">ER</span>
                <div>
                  <strong>{text("Recent errors", "Son hatalar", "خطاهای اخیر")}</strong>
                  <span>
                    {text(
                      `${metrics.errors} recoverable items`,
                      `${metrics.errors} kurtarılabilir öğe`,
                      `${metrics.errors} مورد قابل بازیابی`
                    )}
                  </span>
                </div>
              </article>
              <article>
                <span className="channel-badge">CRM</span>
                <div>
                  <strong>{text("Customer activity", "Müşteri etkinliği", "فعالیت مشتری")}</strong>
                  <span>
                    {text(
                      `${metrics.customers} customer records`,
                      `${metrics.customers} müşteri kaydı`,
                      `${metrics.customers} رکورد مشتری`
                    )}
                  </span>
                </div>
              </article>
            </div>
          </section>
        </div>
      </div>
    </WorkspaceShell>
  );
}
