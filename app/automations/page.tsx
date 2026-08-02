import Link from "next/link";
import { listAutomations } from "@/src/modules/automations/service";
import { AutomationBuilder } from "@/src/modules/automations/ui/automation-builder";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";
import { getRequestPreferences } from "@/src/lib/i18n/server";
export const dynamic = "force-dynamic";
export default async function AutomationsPage({
  searchParams
}: {
  searchParams: Promise<{ recipe?: string }>;
}) {
  const [{ workspace }, { locale, t }] = await Promise.all([
    createMetaRuntime(),
    getRequestPreferences()
  ]);
  const items = await listAutomations(workspace);
  const requestedRecipe = (await searchParams).recipe;
  return (
    <WorkspaceShell active="automations" workspaceName={workspace.name}>
      <div className="content">
        <nav className="section-nav" aria-label="Automation views">
          <Link href="/automations" aria-current="page">
            {locale === "tr" ? "Merkez" : locale === "fa" ? "مرکز" : "Hub"}
          </Link>
          <Link href="/automations/recipes">{t("automations.recipes")}</Link>
          <Link href="/automations/test-center">{t("automations.testCenter")}</Link>
        </nav>
        {workspace.role === "viewer" ? (
          <section className="panel" role="status">
            <h2>{t("common.readOnly")}</h2>
            <p>
              {locale === "tr"
                ? "Viewer rolü otomasyonları inceleyebilir ancak oluşturamaz veya değiştiremez."
                : locale === "fa"
                  ? "نقش Viewer می‌تواند اتوماسیون‌ها را ببیند اما نمی‌تواند آن‌ها را بسازد یا تغییر دهد."
                  : "Your Viewer role can inspect automations but cannot create or change them."}
            </p>
          </section>
        ) : (
          <AutomationBuilder initialRecipe={requestedRecipe} />
        )}
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{t("shell.workspace")}</span>
              <h2>{t("nav.automations")}</h2>
            </div>
            <span>{items.length} total</span>
          </div>
          {items.length ? (
            <div className="automation-list">
              {items.map((item) => (
                <Link href={`/automations/${item.id}`} key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.recipe.replaceAll("_", " ")}</span>
                  </div>
                  <span className="status-pill">{item.status}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-guidance">
              <strong>{t("automations.none")}</strong>
              <span>{t("automations.noneDetail")}</span>
            </div>
          )}
        </section>
      </div>
    </WorkspaceShell>
  );
}
