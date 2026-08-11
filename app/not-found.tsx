import Link from "next/link";
import { getRequestPreferences } from "@/src/lib/i18n/server";
import { BrandLockup } from "@/src/modules/workspaces/ui/brand-lockup";

export default async function NotFound() {
  const { t } = await getRequestPreferences();
  return (
    <main className="onboarding-page">
      <header className="onboarding-header">
        <BrandLockup />
      </header>
      <section className="panel">
        <div className="empty-guidance">
          <strong>{t("system.notFound")}</strong>
          <span>{t("system.notFoundDetail")}</span>
          <Link href="/dashboard">{t("nav.overview")}</Link>
        </div>
      </section>
    </main>
  );
}
