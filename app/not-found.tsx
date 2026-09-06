import Link from "next/link";
import { getRequestPreferences } from "@/src/lib/i18n/server";
import { BrandLockup } from "@/src/modules/workspaces/ui/brand-lockup";

export default async function NotFound() {
  const { t } = await getRequestPreferences();
  return (
    <main className="brand-splash">
      <section className="system-notice">
        <BrandLockup />
        <p className="system-notice-code" aria-hidden="true">
          404
        </p>
        <h1>{t("system.notFound")}</h1>
        <p className="system-notice-detail">{t("system.notFoundDetail")}</p>
        <div className="system-notice-actions">
          <Link className="btn btn-primary" href="/dashboard">
            {t("nav.overview")}
          </Link>
        </div>
      </section>
    </main>
  );
}
