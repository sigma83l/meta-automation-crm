import Link from "next/link";

import { getRequestPreferences } from "@/src/lib/i18n/server";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import {
  TestCenterConsole,
  type TestCenterAutomation,
  type TestCenterConversation
} from "@/src/modules/automations/ui/test-center-console";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";
import { BillingEntitlementError } from "@/src/modules/billing/entitlement-gate";
import { EntitlementBlocked } from "@/src/modules/billing/ui/entitlement-blocked";

export const dynamic = "force-dynamic";

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

  const admin = await createSupabaseAdminClient();
  // Both lists are the operator's own workspace only. The simulation re-checks
  // the automation against the workspace server-side, so a tampered id in the
  // request buys nothing, but there is no reason to offer the choice either.
  const [automationRows, conversationRows] = await Promise.all([
    admin
      .from("automations")
      .select("id,name,recipe,status")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false }),
    admin
      .from("conversations")
      .select("id,state,last_message_at,customers(display_name)")
      .eq("workspace_id", workspace.id)
      .order("last_message_at", { ascending: false })
      .limit(25)
  ]);

  const automations: readonly TestCenterAutomation[] = (automationRows.data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    recipe: String(row.recipe),
    status: String(row.status)
  }));

  const conversations: readonly TestCenterConversation[] = (conversationRows.data ?? []).map(
    (row) => {
      const customer = row.customers as { display_name?: string | null } | null;
      const name = customer?.display_name ?? "Unnamed contact";
      return { id: String(row.id), label: `${name} · ${String(row.state)}` };
    }
  );

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
              "Run a synthetic message through the real turn engine and see every step it takes, why it stopped, and whether anything would go out.",
              "Sentetik bir mesajı gerçek tur motorundan geçirin; attığı her adımı, nerede durduğunu ve dışarı bir şey çıkıp çıkmayacağını görün.",
              "یک پیام ساختگی را از موتور واقعی گفت‌وگو عبور دهید و هر گام، دلیل توقف و اینکه آیا چیزی ارسال می‌شود را ببینید."
            )}
          </p>
        </header>
        <TestCenterConsole automations={automations} conversations={conversations} />
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
        <p>
          <Link href="/automations">
            {pick("Back to automations", "Otomasyonlara dön", "بازگشت به اتوماسیون‌ها")}
          </Link>
        </p>
      </div>
    </WorkspaceShell>
  );
}
