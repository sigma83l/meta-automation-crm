import Link from "next/link";

import { getRequestPreferences } from "@/src/lib/i18n/server";
import { createCrmRuntime } from "@/src/modules/crm/runtime";
import { CustomerActions } from "@/src/modules/crm/ui/customer-actions";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";

const tabs = [
  "Overview",
  "Timeline",
  "Conversations",
  "Files",
  "Automations",
  "Fields & Notes",
  "Audit"
];

export const dynamic = "force-dynamic";

export default async function CustomerPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const selected = (await searchParams).tab ?? "Overview";
  const [{ repository, workspace }, { locale }] = await Promise.all([
    createCrmRuntime(),
    getRequestPreferences()
  ]);
  const text = (english: string, turkish: string, persian: string) =>
    locale === "tr" ? turkish : locale === "fa" ? persian : english;
  const detail = await repository.detail(id);
  const customer = detail.customer as { display_name: string; company_name?: string };
  return (
    <WorkspaceShell active="crm" workspaceName={workspace.name}>
      <div className="content crm-content">
        <Link href="/crm" className="back-link">
          ← {text("Customer list", "Müşteri listesi", "فهرست مشتریان")}
        </Link>
        <section className="customer-hero">
          <span className="eyebrow">
            {text("Customer profile", "Müşteri profili", "پروفایل مشتری")}
          </span>
          <h2>{customer.display_name}</h2>
          <p>
            {customer.company_name ?? text("Independent contact", "Bağımsız kişi", "مخاطب مستقل")}
          </p>
        </section>
        <CustomerActions
          customerId={id}
          displayName={customer.display_name}
          companyName={customer.company_name ?? ""}
        />
        <nav className="detail-tabs" aria-label="Customer sections">
          {tabs.map((tab) => (
            <Link
              key={tab}
              href={`/crm/${id}?tab=${encodeURIComponent(tab)}`}
              aria-current={selected === tab ? "page" : undefined}
            >
              {tabLabel(tab, locale)}
            </Link>
          ))}
        </nav>
        <section className="detail-panel">
          <h3>{tabLabel(selected, locale)}</h3>
          <OwnerDataView
            value={detail[tabKey(selected)] ?? detail.customer}
            emptyLabel={text(
              "No records in this section.",
              "Bu bölümde kayıt yok.",
              "در این بخش رکوردی نیست."
            )}
          />
        </section>
      </div>
    </WorkspaceShell>
  );
}

function OwnerDataView({ value, emptyLabel }: { value: unknown; emptyLabel: string }) {
  const rows = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  if (!rows.length) return <div className="empty-guidance">{emptyLabel}</div>;
  return (
    <div className="owner-data-list">
      {rows.slice(0, 50).map((row, index) => (
        <article key={index}>
          {Object.entries(row as Record<string, unknown>)
            .filter(([key]) => !/(workspace_id|cipher|secret|token|auth_tag|iv)/i.test(key))
            .slice(0, 12)
            .map(([key, item]) => (
              <div key={key}>
                <strong>{key.replaceAll("_", " ")}</strong>
                <span dir="auto">
                  {item === null || item === undefined
                    ? "—"
                    : typeof item === "object"
                      ? Array.isArray(item)
                        ? `${item.length} items`
                        : "Available"
                      : String(item)}
                </span>
              </div>
            ))}
        </article>
      ))}
    </div>
  );
}

function tabLabel(tab: string, locale: "en" | "tr" | "fa") {
  const labels: Record<string, readonly [string, string]> = {
    Overview: ["Genel Bakış", "نمای کلی"],
    Timeline: ["Zaman Çizelgesi", "خط زمانی"],
    Conversations: ["Konuşmalar", "گفتگوها"],
    Files: ["Dosyalar", "فایل‌ها"],
    Automations: ["Otomasyonlar", "اتوماسیون‌ها"],
    "Fields & Notes": ["Alanlar ve Notlar", "فیلدها و یادداشت‌ها"],
    Audit: ["Denetim", "ممیزی"]
  };
  return locale === "en" ? tab : (labels[tab]?.[locale === "tr" ? 0 : 1] ?? tab);
}

function tabKey(tab: string) {
  return (
    (
      {
        Overview: "customer",
        Timeline: "timeline",
        Conversations: "conversations",
        Files: "files",
        Automations: "automations",
        "Fields & Notes": "notes",
        Audit: "audit"
      } as Record<string, string>
    )[tab] ?? "customer"
  );
}
