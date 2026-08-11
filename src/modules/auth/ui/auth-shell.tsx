"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/src/lib/i18n/client";
import { BrandLockup } from "@/src/modules/workspaces/ui/brand-lockup";
import { PreferenceControls } from "@/src/modules/workspaces/ui/preference-controls";

export function AuthShell({
  eyebrow,
  title,
  description,
  children
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <main className="auth-shell">
      <section className="auth-context">
        <div className="auth-brand">
          <BrandLockup />
        </div>
        <div>
          <span className="eyebrow">{t("auth.isolated")}</span>
          <h1>{t("auth.hero")}</h1>
          <p>{t("auth.proofTenant")}</p>
        </div>
        <ol className="auth-proof">
          <li>
            <span>01</span> {t("auth.proofTenant")}
          </li>
          <li>
            <span>02</span> {t("auth.proofSecrets")}
          </li>
          <li>
            <span>03</span> {t("auth.proofSend")}
          </li>
        </ol>
      </section>
      <section className="auth-panel">
        <div className="auth-form-wrap">
          <span className="eyebrow">{eyebrow}</span>
          <PreferenceControls compact />
          <h2>{title}</h2>
          <p>{description}</p>
          {children}
        </div>
      </section>
    </main>
  );
}
