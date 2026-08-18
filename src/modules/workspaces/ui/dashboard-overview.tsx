"use client";

import Link from "next/link";
import { useI18n } from "@/src/lib/i18n/client";
import { WorkspaceShell } from "./workspace-shell";
export function DashboardOverview({
  workspaceName,
  metrics
}: {
  workspaceName: string;
  metrics: {
    automations: number;
    windows: number;
    customers: number;
    reviews: number;
    errors: number;
    whatsapp: string;
    instagram: string;
  };
}) {
  const { t, text } = useI18n();
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
        <section className="metric-grid" aria-label="Workspace status">
          <article>
            <span>{text("Active automations", "Etkin otomasyonlar", "اتوماسیون‌های فعال")}</span>
            <strong>{metrics.automations}</strong>
            <small>{text("Policy checked", "Politika denetimli", "سیاست بررسی شده")}</small>
          </article>
          <article>
            <span>
              {text("Open service windows", "Açık hizmet pencereleri", "پنجره‌های باز گفتگو")}
            </span>
            <strong>{metrics.windows}</strong>
            <small>
              {text(
                "Trusted provider events",
                "Güvenilir sağlayıcı olayları",
                "رویدادهای معتبر ارائه‌دهنده"
              )}
            </small>
          </article>
          <article>
            <span>{text("New customers", "Yeni müşteriler", "مشتریان جدید")}</span>
            <strong>{metrics.customers}</strong>
            <small>{text("Workspace CRM", "Çalışma alanı CRM'i", "CRM فضای کاری")}</small>
          </article>
          <article>
            <span>{text("Human review", "İnsan incelemesi", "بررسی انسانی")}</span>
            <strong>{metrics.reviews}</strong>
            <small>
              {text(
                `${metrics.errors} recent errors`,
                `${metrics.errors} yakın zamanlı hata`,
                `${metrics.errors} خطای اخیر`
              )}
            </small>
          </article>
        </section>
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
                      `${metrics.reviews} conversations waiting`,
                      `${metrics.reviews} görüşme bekliyor`,
                      `${metrics.reviews} گفتگو در انتظار است`
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
