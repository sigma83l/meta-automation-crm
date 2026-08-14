import { createBusinessProfileRuntime } from "@/src/modules/business-profile/runtime";
import { SettingsPanel } from "@/src/modules/business-profile/ui/settings-panel";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";
import { getRequestPreferences } from "@/src/lib/i18n/server";
import { BillingEntitlementError } from "@/src/modules/billing/entitlement-gate";
import { EntitlementBlocked } from "@/src/modules/billing/ui/entitlement-blocked";
export const dynamic = "force-dynamic";
export default async function SettingsPage() {
  const { locale, t } = await getRequestPreferences();
  let runtime: Awaited<ReturnType<typeof createBusinessProfileRuntime>>;
  try {
    runtime = await createBusinessProfileRuntime();
  } catch (error) {
    if (error instanceof BillingEntitlementError) {
      return (
        <WorkspaceShell active="settings" workspaceName={error.workspace.name}>
          <div className="content">
            <EntitlementBlocked locale={locale} status={error.status} />
          </div>
        </WorkspaceShell>
      );
    }
    throw error;
  }
  const { client, repository, workspace } = runtime;
  const [data, memberships] = await Promise.all([
    repository.get(),
    client
      .from("workspace_memberships")
      .select("id,role,status,created_at")
      .eq("workspace_id", workspace.id)
      .order("created_at")
  ]);
  return (
    <WorkspaceShell active="settings" workspaceName={workspace.name}>
      <div className="content">
        {workspace.role === "owner" || workspace.role === "admin" ? (
          <SettingsPanel {...data} memberships={memberships.data ?? []} />
        ) : (
          <section className="settings-card" role="status">
            <h2>{t("settings.permissionDenied")}</h2>
            <p>
              {locale === "tr"
                ? `${workspace.role} rolü çalışma alanı ayarlarını veya şifreli kimlik bilgilerini değiştiremez. Owner veya Admin'e başvurun.`
                : locale === "fa"
                  ? `نقش ${workspace.role} نمی‌تواند تنظیمات فضای کاری یا اطلاعات رمزگذاری‌شده را تغییر دهد. از Owner یا Admin کمک بگیرید.`
                  : `Your ${workspace.role} role cannot change workspace settings or encrypted credentials. Ask an Owner or Admin.`}
            </p>
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
