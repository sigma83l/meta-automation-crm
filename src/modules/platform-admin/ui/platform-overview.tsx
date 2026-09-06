"use client";

import Link from "next/link";

import { useI18n } from "@/src/lib/i18n/client";

import type { ImpersonationGrant, PlatformAdminRole, PlatformOverview } from "../contracts";
import { AdminShell } from "./admin-shell";
import { ReasonAction } from "./reason-action";

/**
 * The platform overview.
 *
 * Same discipline as the workspace overview it sits beside: the top row is work
 * waiting on a person, not totals. Totals are reassuring and inert — "412
 * workspaces" changes nothing anybody does — whereas an unrecovered dead letter
 * or a live impersonation window is a thing somebody has to close today. The
 * inventory counts still appear, below, where they belong.
 */
export function PlatformOverviewPanel({
  role,
  overview,
  liveGrants,
  grantHolders
}: {
  role: PlatformAdminRole;
  overview: PlatformOverview | null;
  liveGrants: readonly ImpersonationGrant[];
  /**
   * Who holds each open window, by staff user id.
   *
   * The list named the customer being read and never the person reading them,
   * which is the half an owner scanning this panel actually needs: "somebody is
   * inside Acme right now" is not something anybody can act on.
   */
  grantHolders: Readonly<Record<string, string>>;
}) {
  const { text } = useI18n();
  // An em dash rather than 0 when the read failed: reporting an empty queue on
  // the strength of a query that did not run is the one reading of this panel
  // that could send somebody home with work outstanding.
  const count = (value: number | undefined) => (overview ? String(value ?? 0) : "—");

  const attention: ReadonlyArray<readonly [string, string, string]> = [
    [
      text("Failed automation steps", "Başarısız adımlar", "گام‌های ناموفق"),
      count(overview?.attention.unrecoveredDeadLetters),
      "/admin/system"
    ],
    [
      text("Connections needing attention", "İlgi bekleyen bağlantılar", "اتصال‌های نیازمند توجه"),
      count(overview?.attention.connectionsNeedingAttention),
      "/admin/workspaces"
    ],
    [
      text("Open support tickets", "Açık destek talepleri", "تیکت‌های باز پشتیبانی"),
      count(overview?.attention.openSupportTickets),
      "/admin/workspaces"
    ],
    [
      text("Live customer views", "Canlı müşteri görüntüleme", "مشاهده‌های زنده مشتری"),
      count(overview?.attention.activeImpersonations),
      "/admin/audit"
    ]
  ];

  return (
    <AdminShell active="overview" role={role}>
      <div className="content">
        <section className="panel">
          <div className="panel-heading">
            <h2>{text("Needs a person", "Kişi gerektirir", "نیازمند رسیدگی")}</h2>
          </div>
          <div className="metric-grid">
            {attention.map(([label, value, href]) => (
              <Link key={label} className="summary-card" href={href}>
                <span className="eyebrow">{label}</span>
                <strong>{value}</strong>
              </Link>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>{text("Inventory", "Envanter", "فهرست")}</h2>
          </div>
          <div className="metric-grid admin-inventory">
            <div className="summary-card">
              <span className="eyebrow">
                {text("Workspaces", "Çalışma alanları", "فضاهای کاری")}
              </span>
              <strong>{count(overview?.workspaces.total)}</strong>
              <small>
                {count(overview?.workspaces.active)} {text("active", "etkin", "فعال")} ·{" "}
                {count(overview?.workspaces.disabled)} {text("suspended", "askıda", "معلق")}
              </small>
            </div>
            <div className="summary-card">
              <span className="eyebrow">{text("People", "Kişiler", "افراد")}</span>
              <strong>{count(overview?.users.total)}</strong>
              <small>
                {count(overview?.users.active)} {text("active", "etkin", "فعال")} ·{" "}
                {count(overview?.users.disabled)} {text("suspended", "askıda", "معلق")}
              </small>
            </div>
            {/*
              One card, not one per status. Mapping the status map straight to
              cards produced a row of tiles all captioned "Subscriptions", each
              holding a different number and a raw status word underneath — so
              the caption identified none of them and the reader had to compare
              the small print to tell what they were counting. The total is the
              figure that belongs beside Workspaces and People; the split goes
              underneath, in the same place the other two cards put theirs.
            */}
            <div className="summary-card">
              <span className="eyebrow">{text("Subscriptions", "Abonelikler", "اشتراک‌ها")}</span>
              <strong>
                {overview
                  ? String(
                      Object.values(overview.subscriptions).reduce((sum, total) => sum + total, 0)
                    )
                  : "—"}
              </strong>
              <small dir="ltr">
                {Object.entries(overview?.subscriptions ?? {})
                  .map(([status, total]) => `${total} ${status}`)
                  .join(" · ") || "—"}
              </small>
            </div>
          </div>
        </section>

        {liveGrants.length > 0 ? (
          <section className="panel">
            <div className="panel-heading">
              <h2>
                {text(
                  "Customer views open right now",
                  "Şu anda açık müşteri görüntülemeleri",
                  "مشاهده‌های باز مشتری در این لحظه"
                )}
              </h2>
            </div>
            <ul className="activity-list">
              {liveGrants.map((grant) => (
                <li key={grant.id}>
                  <strong>{grant.workspaceName}</strong>
                  <span>{grant.reason}</span>
                  <small>
                    {text("opened by", "açan", "باز شده توسط")}{" "}
                    {grantHolders[grant.adminId] ??
                      text("a staff member", "bir personel", "یکی از کارکنان")}{" "}
                    · {text("until", "bitiş", "تا")}{" "}
                    <time dateTime={grant.expiresAt}>
                      {new Date(grant.expiresAt).toLocaleTimeString()}
                    </time>
                  </small>
                  {/*
                    Every close used to be scoped to the caller's own grants, so
                    this list showed an owner a window they could not shut. The
                    server decides who may end somebody else's; this offers it,
                    and a support role reaching for a colleague's window is
                    refused there rather than here.
                  */}
                  <ReasonAction
                    endpoint="impersonation"
                    body={{ action: "close_grant", grantId: grant.id }}
                    label={text("Close this view", "Bu görüntülemeyi kapat", "بستن این مشاهده")}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </AdminShell>
  );
}
