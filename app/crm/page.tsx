import { createCrmRuntime } from "@/src/modules/crm/runtime";
import { CrmControls } from "@/src/modules/crm/ui/crm-controls";
import { CustomerTable } from "@/src/modules/crm/ui/customer-table";
import { RadarViewTabs } from "@/src/modules/crm/ui/radar-views";
import {
  BUILT_IN_RADAR_VIEWS,
  isRadarViewKey,
  landingRadarView,
  type RadarViewFilters,
  type RadarViewKey
} from "@/src/modules/crm/radar-views";
import type { RadarPage, RadarQuery } from "@/src/modules/crm/contracts";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";
import { getRequestPreferences } from "@/src/lib/i18n/server";
import { BillingEntitlementError } from "@/src/modules/billing/entitlement-gate";
import { EntitlementBlocked } from "@/src/modules/billing/ui/entitlement-blocked";

export const dynamic = "force-dynamic";

/** One page of the radar. Large enough to be a working queue, small enough to render. */
const PAGE_SIZE = 50;

type Params = {
  view?: string;
  q?: string;
  status?: string;
  after?: string;
  afterId?: string;
};

export default async function CrmPage({ searchParams }: { searchParams: Promise<Params> }) {
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
  const savedViews = await repository.savedViews();

  let activeKey: RadarViewKey | null = null;
  let activeSavedViewId: string | null = null;
  let filters: RadarViewFilters;
  const saved = params.view?.startsWith("saved:")
    ? savedViews.find((view) => view.id === params.view!.slice("saved:".length))
    : undefined;

  if (saved) {
    activeSavedViewId = saved.id;
    filters = saved.filters;
  } else if (isRadarViewKey(params.view)) {
    activeKey = params.view;
    filters = BUILT_IN_RADAR_VIEWS[activeKey];
  } else {
    // No view asked for - or one that has since been deleted. Landing on Needs
    // Attention only when it has something in it, per the pack: an empty queue
    // as the first thing an operator sees reads as a broken page.
    const probe = await repository.radar({ ...BUILT_IN_RADAR_VIEWS.needs_attention, limit: 1 });
    activeKey = landingRadarView(probe.rows.length > 0);
    filters = BUILT_IN_RADAR_VIEWS[activeKey];
  }

  const status =
    params.status === "active" || params.status === "archived" ? params.status : undefined;
  // The status control and the search box compose over the view rather than
  // replacing it, so "archived, in Follow-up Due" is one question.
  const query: RadarQuery = {
    ...filters,
    ...(status ? { status } : {}),
    ...(params.q ? { query: params.q } : {}),
    ...(params.after && params.afterId
      ? { cursor: { updatedAt: params.after, customerId: params.afterId } }
      : {}),
    limit: PAGE_SIZE
  };

  let page: RadarPage;
  try {
    page = await repository.radar(query);
  } catch (error) {
    // A cursor arrives through the URL, so it can be stale, edited or copied
    // from another workspace. Starting again beats an error screen.
    if (!(error instanceof Error) || error.message !== "INVALID_RADAR_CURSOR") throw error;
    page = await repository.radar({ ...query, cursor: null });
  }

  const base = new URLSearchParams();
  if (params.view) base.set("view", params.view);
  if (params.q) base.set("q", params.q);
  if (status) base.set("status", status);
  const firstPageHref = params.after ? `/crm?${base}` : null;
  const nextPage = new URLSearchParams(base);
  if (page.nextCursor) {
    nextPage.set("after", page.nextCursor.updatedAt);
    nextPage.set("afterId", page.nextCursor.customerId);
  }

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
        <RadarViewTabs
          savedViews={savedViews}
          activeKey={activeKey}
          activeSavedViewId={activeSavedViewId}
          filters={filters}
          canManage={workspace.role !== "viewer"}
        />
        <CustomerTable
          rows={page.rows}
          currentUserId={workspace.userId}
          nextPageHref={page.nextCursor ? `/crm?${nextPage}` : null}
          firstPageHref={firstPageHref}
        />
      </div>
    </WorkspaceShell>
  );
}
