"use client";

import { useI18n } from "@/src/lib/i18n/client";
import { BrandLockup } from "@/src/modules/workspaces/ui/brand-lockup";

export default function ApplicationError({ reset }: { reset: () => void }) {
  const { t } = useI18n();
  return (
    <main className="onboarding-page">
      <header className="onboarding-header">
        <BrandLockup />
      </header>
      <section className="panel" role="alert">
        <div className="empty-guidance">
          <strong>{t("system.error")}</strong>
          <span>{t("system.errorDetail")}</span>
          <button onClick={reset}>{t("common.retry")}</button>
        </div>
      </section>
    </main>
  );
}
