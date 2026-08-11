import { getRequestPreferences } from "@/src/lib/i18n/server";

export default async function Loading() {
  const { t } = await getRequestPreferences();
  return (
    <main className="content" aria-busy="true">
      <section className="panel">
        <div className="empty-guidance">
          <strong>{t("common.loading")}</strong>
          <span>{t("crm.customers")}</span>
        </div>
      </section>
    </main>
  );
}
