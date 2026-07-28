import Link from "next/link";

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
  const { repository, workspace } = await createCrmRuntime();
  const detail = await repository.detail(id);
  const customer = detail.customer as { display_name: string; company_name?: string };
  return (
    <WorkspaceShell active="crm" workspaceName={workspace.name}>
      <div className="content crm-content">
        <Link href="/crm" className="back-link">
          ← Customer list
        </Link>
        <section className="customer-hero">
          <span className="eyebrow">Customer profile</span>
          <h2>{customer.display_name}</h2>
          <p>{customer.company_name ?? "Independent contact"}</p>
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
              {tab}
            </Link>
          ))}
        </nav>
        <section className="detail-panel">
          <h3>{selected}</h3>
          <pre>{JSON.stringify(detail[tabKey(selected)] ?? detail.customer, null, 2)}</pre>
        </section>
      </div>
    </WorkspaceShell>
  );
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
