import { createCrmRuntime } from "@/src/modules/crm/runtime";
import { CrmControls } from "@/src/modules/crm/ui/crm-controls";
import { CustomerTable } from "@/src/modules/crm/ui/customer-table";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";
import { getRequestPreferences } from "@/src/lib/i18n/server";
import { BillingEntitlementError } from "@/src/modules/billing/entitlement-gate";
import { EntitlementBlocked } from "@/src/modules/billing/ui/entitlement-blocked";

export const dynamic = "force-dynamic";

export default async function CrmPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const { locale, t } = await getRequestPreferences();
  let runtime: Awaited<ReturnType<typeof createCrmRuntime>>;
  try {
    runtime = await createCrmRuntime();
  } catch (error) {
    if (error instanceof BillingEntitlementError) {
      return (
        <WorkspaceShell active="crm" workspaceName={error.workspace.name}>
          <div className="content crm-content">
            <EntitlementBlocked locale={locale} status={error.status} />
          </div>
        </WorkspaceShell>
      );
    }
    throw error;
  }
  const { repository, workspace } = runtime;
  const customers = await repository.list({
    ...(params.q ? { query: params.q } : {}),
    ...(params.status === "active" || params.status === "archived" ? { status: params.status } : {})
  });
  return (
    <WorkspaceShell active="crm" workspaceName={workspace.name}>
      <div className="content crm-content">
        {workspace.role === "viewer" ? (
          <section className="panel" role="status">
            <h2>{t("common.readOnly")}</h2>
            <p>
              {locale === "tr"
                ? "Viewer rolü CRM kayıtlarını görebilir; oluşturma, içe veya dışa aktarma yapamaz."
                : locale === "fa"
                  ? "نقش Viewer می‌تواند رکوردهای CRM را ببیند، اما امکان ساخت، ورود یا خروج داده ندارد."
                  : "Your Viewer role can review CRM records but cannot create, import, or export them."}
            </p>
          </section>
        ) : (
          <CrmControls />
        )}
        <CustomerTable customers={customers} />
      </div>
    </WorkspaceShell>
  );
}
