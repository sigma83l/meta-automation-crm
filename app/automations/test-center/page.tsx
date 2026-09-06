import Link from "next/link";

import { getRequestPreferences } from "@/src/lib/i18n/server";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";
import { BillingEntitlementError } from "@/src/modules/billing/entitlement-gate";
import { EntitlementBlocked } from "@/src/modules/billing/ui/entitlement-blocked";

const testModes = [
  ["UI preview", "Layout only", "Does not execute provider, AI or policy contracts."],
  ["Deterministic simulation", "Available", "Runs synthetic input through the local policy path."],
  ["AI batch evaluation", "Synthetic only", "Uses bounded fixtures and records no customer data."],
  ["Integration sandbox", "Available after connection setup", "Requires signed sandbox fixtures."],
  ["Allowlisted live pilot", "Locked", "Prompt 11 approval and verified assets are required."]
] as const;

export default async function TestCenterPage() {
  const { locale } = await getRequestPreferences();
  let workspace: Awaited<ReturnType<typeof createMetaRuntime>>["workspace"];
  try {
    ({ workspace } = await createMetaRuntime());
  } catch (error) {
    if (error instanceof BillingEntitlementError) {
      return (
        <WorkspaceShell active="automations" workspaceName={error.workspace.name}>
          <div className="content">
            <EntitlementBlocked locale={locale} status={error.status} />
          </div>
        </WorkspaceShell>
      );
    }
    throw error;
  }
  const pick = (en: string, tr: string, fa: string) =>
    locale === "tr" ? tr : locale === "fa" ? fa : en;
  return (
    <WorkspaceShell active="automations" workspaceName={workspace.name}>
      <div className="content">
        <header className="page-intro">
          <span className="eyebrow">
            {pick(
              "Evidence before activation",
              "Etkinleştirmeden önce kanıt",
              "شواهد پیش از فعال‌سازی"
            )}
          </span>
          <h2>{pick("Test Center", "Test Merkezi", "مرکز آزمون")}</h2>
          <p>
            {pick(
              "Preview, simulation, sandbox and live pilot are separate evidence classes.",
              "Önizleme, simülasyon, Sandbox ve canlı pilot ayrı kanıt sınıflarıdır.",
              "پیش‌نمایش، شبیه‌سازی، محیط آزمایشی و پایلوت زنده شواهد جداگانه‌اند."
            )}
          </p>
        </header>
        <section className="panel test-center">
          {testModes.map(([name, status, detail]) => (
            <article key={name}>
              <div>
                <strong>{name}</strong>
                <span>{detail}</span>
              </div>
              <span className="status-pill">{status}</span>
            </article>
          ))}
        </section>
        <section className="simulation-console">
          <div>
            <span className="eyebrow">
              {pick("Synthetic input", "Sentetik girdi", "ورودی ساختگی")}
            </span>
            <p dir="auto">“What is the approved price and when are you open?”</p>
          </div>
          <div>
            <span className="eyebrow">
              {pick("Actual path", "Gerçekleşen yol", "مسیر اجراشده")}
            </span>
            <strong>INBOUND → POLICY → KNOWLEDGE → HUMAN REVIEW</strong>
          </div>
          <div>
            <span className="eyebrow">
              {pick("Blocked reason", "Engelleme nedeni", "دلیل مسدودشدن")}
            </span>
            <p>
              {pick(
                "No approved price is configured. No outbound message is authorized.",
                "Onaylı fiyat tanımlı değil. Giden mesaja izin verilmedi.",
                "قیمت تأییدشده‌ای تنظیم نشده؛ هیچ پیام خروجی مجاز نیست."
              )}
            </p>
          </div>
          <Link href="/automations">
            {pick(
              "Choose an automation and run its safe test",
              "Bir otomasyon seçip güvenli testini çalıştırın",
              "یک اتوماسیون انتخاب و آزمون امن آن را اجرا کنید"
            )}
          </Link>
        </section>
      </div>
    </WorkspaceShell>
  );
}
