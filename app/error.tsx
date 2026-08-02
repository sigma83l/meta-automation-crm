"use client";

import { useI18n } from "@/src/lib/i18n/client";

export default function ApplicationError({ reset }: { reset: () => void }) {
  const { t } = useI18n();
  return (
    <main className="onboarding-page">
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
