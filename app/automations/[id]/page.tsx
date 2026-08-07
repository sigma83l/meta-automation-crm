import Link from "next/link";
import { notFound } from "next/navigation";
import { getRequestPreferences } from "@/src/lib/i18n/server";
import { listAutomations } from "@/src/modules/automations/service";
import { AutomationActions } from "@/src/modules/automations/ui/automation-builder";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";
const detailTabs = ["overview", "runs", "versions", "issues"] as const;
type DetailTab = (typeof detailTabs)[number];

export default async function AutomationDetail({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ client, workspace }, { locale }] = await Promise.all([
    createMetaRuntime(),
    getRequestPreferences()
  ]);
  const pick = (en: string, tr: string, fa: string) =>
    locale === "tr" ? tr : locale === "fa" ? fa : en;
  const id = (await params).id;
  const requestedTab = (await searchParams).tab;
  const selected: DetailTab = detailTabs.includes(requestedTab as DetailTab)
    ? (requestedTab as DetailTab)
    : "overview";
  const item = (await listAutomations(workspace)).find((row) => row.id === id);
  if (!item) notFound();
  const [runs, versions] = await Promise.all([
    client
      .from("automation_runs")
      .select("id,state,failure_code,created_at,updated_at")
      .eq("workspace_id", workspace.id)
      .eq("automation_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    client
      .from("automation_versions")
      .select("id,version,created_at")
      .eq("workspace_id", workspace.id)
      .eq("automation_id", id)
      .order("version", { ascending: false })
      .limit(50)
  ]);
  const runIds = (runs.data ?? []).map((run) => run.id);
  const issues = runIds.length
    ? await client
        .from("automation_dead_letters")
        .select("error_code,safe_summary,recoverable,recovered_at,created_at")
        .eq("workspace_id", workspace.id)
        .in("run_id", runIds)
        .order("created_at", { ascending: false })
        .limit(50)
    : { data: [] };
  const label = (tab: DetailTab) =>
    tab === "overview"
      ? pick("Overview", "Genel bakış", "نمای کلی")
      : tab === "runs"
        ? pick("Runs", "Çalışmalar", "اجراها")
        : tab === "versions"
          ? pick("Versions", "Sürümler", "نسخه‌ها")
          : pick("Issues", "Sorunlar", "مشکلات");
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value)
    );
  return (
    <WorkspaceShell active="automations" workspaceName={workspace.name}>
      <div className="content">
        <section className="customer-hero">
          <span className="eyebrow">{item.recipe.replaceAll("_", " ")}</span>
          <h2>{item.name}</h2>
          <p>
            {pick("Status", "Durum", "وضعیت")}: <bdi>{item.status}</bdi>
          </p>
        </section>
        <nav
          className="detail-tabs"
          aria-label={pick("Automation detail", "Otomasyon ayrıntısı", "جزئیات اتوماسیون")}
        >
          {detailTabs.map((tab) => (
            <Link
              href={tab === "overview" ? `/automations/${id}` : `/automations/${id}?tab=${tab}`}
              aria-current={selected === tab ? "page" : undefined}
              key={tab}
            >
              {label(tab)}
            </Link>
          ))}
        </nav>
        {selected === "overview" ? (
          <section className="detail-panel">
            <h2>{label("overview")}</h2>
            <p>
              {pick(
                "Published versions are immutable. Every send rechecks workspace, connection, consent, window, confidence and takeover policy.",
                "Yayınlanan sürümler değişmezdir. Her gönderimde çalışma alanı, bağlantı, izin, pencere, güven ve insan devralma politikası yeniden denetlenir.",
                "نسخه‌های منتشرشده تغییرناپذیرند. هر ارسال، فضای کاری، اتصال، رضایت، پنجره زمانی، اطمینان و سیاست تحویل به انسان را دوباره بررسی می‌کند."
              )}
            </p>
            {workspace.role === "viewer" ? (
              <p role="status">
                {pick(
                  "Viewer access is read-only.",
                  "Viewer erişimi salt okunurdur.",
                  "دسترسی بیننده فقط خواندنی است."
                )}
              </p>
            ) : (
              <AutomationActions id={id} status={item.status} />
            )}
            <div className="state-grid">
              <article>
                <strong>{pick("Connection", "Bağlantı", "اتصال")}</strong>
                <span>{pick("Sandbox healthy", "Sandbox sağlıklı", "محیط آزمایشی سالم")}</span>
              </article>
              <article>
                <strong>{pick("Last failure", "Son hata", "آخرین خطا")}</strong>
                <span>
                  {issues.data?.length
                    ? pick(
                        "Review open issues",
                        "Açık sorunları inceleyin",
                        "مشکلات باز را بررسی کنید"
                      )
                    : pick("No recent failure", "Yakın zamanda hata yok", "خطای تازه‌ای نیست")}
                </span>
              </article>
              <article>
                <strong>{pick("Runs", "Çalışmalar", "اجراها")}</strong>
                <span>
                  {new Intl.NumberFormat(locale).format(runs.data?.length ?? 0)} {label("runs")}
                </span>
              </article>
            </div>
          </section>
        ) : null}
        {selected === "runs" ? (
          <section className="detail-panel">
            <h2>{label("runs")}</h2>
            {runs.data?.length ? (
              <div className="detail-record-list">
                {runs.data.map((run) => (
                  <article key={run.id}>
                    <strong>
                      <bdi>{run.state}</bdi>
                    </strong>
                    <time dateTime={run.created_at}>{formatDate(run.created_at)}</time>
                    <span>
                      {run.failure_code ? (
                        <bdi>{run.failure_code}</bdi>
                      ) : (
                        pick("No recorded failure", "Kayıtlı hata yok", "خطای ثبت‌شده‌ای نیست")
                      )}
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-guidance">
                <strong>{pick("No runs yet", "Henüz çalışma yok", "هنوز اجرایی نیست")}</strong>
                <span>
                  {pick(
                    "Run a safe test to create the first evidence record.",
                    "İlk kanıt kaydını oluşturmak için güvenli bir test çalıştırın.",
                    "برای ساخت نخستین رکورد شواهد، آزمایش امن اجرا کنید."
                  )}
                </span>
              </div>
            )}
          </section>
        ) : null}
        {selected === "versions" ? (
          <section className="detail-panel">
            <h2>{label("versions")}</h2>
            <div className="detail-record-list">
              {(versions.data ?? []).map((version) => (
                <article key={version.id}>
                  <strong>
                    {pick("Version", "Sürüm", "نسخه")} {version.version}
                  </strong>
                  <span>
                    {version.id === item.active_version_id
                      ? pick(
                          "Current immutable version",
                          "Geçerli değişmez sürüm",
                          "نسخه تغییرناپذیر فعلی"
                        )
                      : pick("Immutable history", "Değişmez geçmiş", "تاریخچه تغییرناپذیر")}
                  </span>
                  <time dateTime={version.created_at}>{formatDate(version.created_at)}</time>
                </article>
              ))}
            </div>
          </section>
        ) : null}
        {selected === "issues" ? (
          <section className="detail-panel">
            <h2>{label("issues")}</h2>
            {issues.data?.length ? (
              <div className="detail-record-list">
                {issues.data.map((issue, index) => (
                  <article key={`${issue.created_at}-${index}`}>
                    <strong>{issue.safe_summary}</strong>
                    <span>
                      <bdi>{issue.error_code}</bdi> ·{" "}
                      {issue.recovered_at
                        ? pick("Recovered", "Giderildi", "رفع‌شده")
                        : issue.recoverable
                          ? pick("Recovery available", "Giderilebilir", "قابل رفع")
                          : pick(
                              "Human review required",
                              "İnsan incelemesi gerekli",
                              "نیازمند بررسی انسانی"
                            )}
                    </span>
                    <time dateTime={issue.created_at}>{formatDate(issue.created_at)}</time>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-guidance">
                <strong>{pick("No open issues", "Açık sorun yok", "مشکل بازی نیست")}</strong>
                <span>
                  {pick(
                    "No failed run requires recovery.",
                    "Kurtarma gerektiren başarısız çalışma yok.",
                    "هیچ اجرای ناموفقی به بازیابی نیاز ندارد."
                  )}
                </span>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </WorkspaceShell>
  );
}
