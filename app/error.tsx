"use client";

import Link from "next/link";
import { useI18n } from "@/src/lib/i18n/client";
import { BrandLockup } from "@/src/modules/workspaces/ui/brand-lockup";

export default function ApplicationError({ reset }: { reset: () => void }) {
  const { t } = useI18n();
  return (
    <main className="brand-splash">
      <section className="system-notice system-notice-alert" role="alert">
        <BrandLockup />
        <h1>{t("system.error")}</h1>
        <p className="system-notice-detail">{t("system.errorDetail")}</p>
        <div className="system-notice-actions">
          <button className="btn btn-primary" type="button" onClick={reset}>
            {t("common.retry")}
          </button>
          <Link className="btn btn-ghost" href="/dashboard">
            {t("nav.overview")}
          </Link>
        </div>
      </section>
    </main>
  );
}
