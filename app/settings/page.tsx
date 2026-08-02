import { createBusinessProfileRuntime } from "@/src/modules/business-profile/runtime";
import { SettingsPanel } from "@/src/modules/business-profile/ui/settings-panel";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";
import { getRequestPreferences } from "@/src/lib/i18n/server";
export const dynamic = "force-dynamic";
export default async function SettingsPage() {
  const [{ client, repository, workspace }, { locale, t }] = await Promise.all([
    createBusinessProfileRuntime(),
    getRequestPreferences()
  ]);
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
