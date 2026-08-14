"use client";

import { useI18n } from "@/src/lib/i18n/client";
import { EmptyState } from "@/src/components/ui/empty-state";

export default function ApplicationError({ reset }: { reset: () => void }) {
  const { t } = useI18n();
  return (
    <main className="onboarding-page">
      <section className="panel" role="alert">
        <EmptyState
          title={t("system.error")}
          description={t("system.errorDetail")}
          action={
            <button type="button" className="btn btn-primary" onClick={reset}>
              {t("common.retry")}
            </button>
          }
        />
      </section>
    </main>
  );
}
