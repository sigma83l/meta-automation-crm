import Link from "next/link";
import { getRequestPreferences } from "@/src/lib/i18n/server";
import { EmptyState } from "@/src/components/ui/empty-state";

export default async function NotFound() {
  const { t } = await getRequestPreferences();
  return (
    <main className="onboarding-page">
      <section className="panel">
        <EmptyState
          title={t("system.notFound")}
          description={t("system.notFoundDetail")}
          action={
            <Link href="/dashboard" className="btn btn-primary">
              {t("nav.overview")}
            </Link>
          }
        />
      </section>
    </main>
  );
}
