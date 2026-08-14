import { createBillingRuntime } from "@/src/modules/billing/runtime";
import { getBillingStatus } from "@/src/modules/billing/subscription-service";
import { BillingPanel } from "@/src/modules/billing/ui/billing-panel";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";
import { getRequestPreferences } from "@/src/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function BillingSettingsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ workspace }, { locale, t }, params] = await Promise.all([
    createBillingRuntime(),
    getRequestPreferences(),
    searchParams
  ]);
  const isManager = workspace.role === "owner" || workspace.role === "admin";
  const billing = isManager ? await getBillingStatus(workspace) : null;
  const callbackStatus = typeof params.status === "string" ? params.status : null;

  return (
    <WorkspaceShell active="settings" workspaceName={workspace.name}>
      <div className="content">
        {isManager && billing ? (
          <BillingPanel billing={billing} callbackStatus={callbackStatus} />
        ) : (
          <section className="settings-card" role="status">
            <h2>{t("settings.permissionDenied")}</h2>
            <p>
              {locale === "tr"
                ? `${workspace.role} rolü faturalandırma ayarlarını değiştiremez. Owner veya Admin'e başvurun.`
                : locale === "fa"
                  ? `نقش ${workspace.role} نمی‌تواند تنظیمات صورتحساب را تغییر دهد. از Owner یا Admin کمک بگیرید.`
                  : `Your ${workspace.role} role cannot change billing settings. Ask an Owner or Admin.`}
            </p>
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
