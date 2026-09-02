"use client";

import { useI18n } from "@/src/lib/i18n/client";

import { roleAllows, type PlatformAdminRole } from "../contracts";
import { AdminShell } from "./admin-shell";
import { ReasonAction } from "./reason-action";

export type CatalogueEntry = Readonly<{
  key: string;
  displayName: string;
  description: string;
  defaultEnabled: boolean;
}>;

export type PlanDefaults = Readonly<{
  id: string;
  planKey: string;
  displayName: string;
  active: boolean;
  defaults: Readonly<Record<string, boolean>>;
}>;

/**
 * The catalogue, and what each plan grants.
 *
 * The grid is the point. A per-workspace override screen answers "why does this
 * customer have that?"; only a plan-by-feature grid answers "what does Growth
 * actually include?", which is the question that decides pricing and the one a
 * catalogue with no such view gets wrong quietly.
 */
export function FeatureCatalogue({
  role,
  catalogue,
  plans,
  overrideCounts
}: {
  role: PlatformAdminRole;
  catalogue: readonly CatalogueEntry[];
  plans: readonly PlanDefaults[];
  /** How many workspaces currently override each flag. */
  overrideCounts: Readonly<Record<string, number>>;
}) {
  const { text } = useI18n();
  const canEdit = roleAllows(role, "features");

  return (
    <AdminShell active="features" role={role}>
      <div className="content">
        <section className="panel">
          <div className="panel-heading">
            <h2>{text("What each plan includes", "Her planın kapsamı", "محتوای هر طرح")}</h2>
          </div>
          <p className="section-note">
            {text(
              "A workspace override beats the plan. Archiving a feature beats both.",
              "Çalışma alanı istisnası planı geçersiz kılar. Bir özelliği arşivlemek ikisini birden geçersiz kılar.",
              "استثنای فضای کاری بر طرح غالب است. بایگانی یک قابلیت بر هر دو غالب است."
            )}
          </p>
          <div className="crm-table-panel">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>{text("Feature", "Özellik", "قابلیت")}</th>
                  <th>{text("Default", "Varsayılan", "پیش‌فرض")}</th>
                  {plans.map((plan) => (
                    <th key={plan.id}>{plan.displayName}</th>
                  ))}
                  <th>{text("Overrides", "İstisnalar", "استثناها")}</th>
                </tr>
              </thead>
              <tbody>
                {catalogue.map((entry) => (
                  <tr key={entry.key}>
                    <td>
                      <strong>{entry.displayName}</strong>
                      <small>{entry.description}</small>
                      <small dir="ltr">{entry.key}</small>
                    </td>
                    <td>
                      {entry.defaultEnabled
                        ? text("On", "Açık", "روشن")
                        : text("Off", "Kapalı", "خاموش")}
                    </td>
                    {plans.map((plan) => {
                      const explicit = plan.defaults[entry.key];
                      const enabled = explicit ?? entry.defaultEnabled;
                      return (
                        <td key={plan.id}>
                          <span
                            className={enabled ? "status-pill" : "status-pill status-pill-warning"}
                          >
                            {enabled ? text("On", "Açık", "روشن") : text("Off", "Kapalı", "خاموش")}
                          </span>
                          {/*
                            An inherited cell says so. Without it a plan that
                            never mentioned a feature is indistinguishable from
                            one that deliberately granted it, and the two
                            diverge the moment the catalogue default moves.
                          */}
                          {explicit === undefined ? (
                            <small>{text("inherited", "devralındı", "ارثی")}</small>
                          ) : null}
                          {canEdit ? (
                            <ReasonAction
                              endpoint="features"
                              body={{
                                action: "set_plan_default",
                                planId: plan.id,
                                flagKey: entry.key,
                                enabled: !enabled
                              }}
                              label={
                                enabled
                                  ? text("Turn off", "Kapat", "خاموش کن")
                                  : text("Turn on", "Aç", "روشن کن")
                              }
                            />
                          ) : null}
                        </td>
                      );
                    })}
                    <td>{overrideCounts[entry.key] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {canEdit ? (
          <section className="panel">
            <div className="panel-heading">
              <h2>{text("Retire a feature", "Bir özelliği kaldır", "بازنشستگی یک قابلیت")}</h2>
            </div>
            <p className="section-note">
              {text(
                "Archiving turns a feature off for every workspace at once, whatever their plan or override says.",
                "Arşivleme, planları veya istisnaları ne olursa olsun bir özelliği tüm çalışma alanlarında kapatır.",
                "بایگانی یک قابلیت را برای همه فضاهای کاری خاموش می‌کند، صرف‌نظر از طرح یا استثنای آن‌ها."
              )}
            </p>
            {catalogue.map((entry) => (
              <div className="settings-card" key={entry.key}>
                <strong>{entry.displayName}</strong>
                <ReasonAction
                  endpoint="features"
                  body={{ action: "set_archived", flagKey: entry.key, archived: true }}
                  label={text("Archive", "Arşivle", "بایگانی")}
                  confirmLabel={text("Confirm archive", "Arşivlemeyi onayla", "تأیید بایگانی")}
                  variant="danger"
                />
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </AdminShell>
  );
}
