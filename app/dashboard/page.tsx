import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { DashboardOverview } from "@/src/modules/workspaces/ui/dashboard-overview";
import { loadWorkspaceOverview } from "@/src/modules/workspaces/server/overview-read-model";
import { resolveTrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const client = await createSupabaseServerClient();
  const { data } = await client.from("onboarding_states").select("auth_completed_at").maybeSingle();
  if (!data?.auth_completed_at) redirect("/onboarding");
  const workspace = await resolveTrustedWorkspace(client);
  // The overview counts come from one view rather than from counts assembled
  // here, so the definition of "awaiting human" lives in a single place that
  // the migration tests exercise. The totals below it stay as counts: they are
  // not in the view, and inventing a second definition of them here would be
  // the duplication the view exists to remove.
  const [overview, automations, windows, customers, errors, connections] = await Promise.all([
    loadWorkspaceOverview(client, workspace.id),
    client
      .from("automations")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("status", "ACTIVE"),
    client
      .from("service_windows")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("policy_state", "open"),
    client
      .from("customers")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspace.id),
    client
      .from("automation_dead_letters")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .is("recovered_at", null),
    client
      .from("meta_connections")
      .select("channel,status,last_health_status")
      .eq("workspace_id", workspace.id)
  ]);
  const health = (channel: string) => {
    const row = connections.data?.find((item) => item.channel === channel);
    return row ? `${row.status} · ${row.last_health_status}` : "Disconnected";
  };
  return (
    <DashboardOverview
      workspaceName={workspace.name}
      overview={overview}
      metrics={{
        automations: automations.count ?? 0,
        windows: windows.count ?? 0,
        customers: customers.count ?? 0,
        errors: errors.count ?? 0,
        whatsapp: health("whatsapp"),
        instagram: health("instagram")
      }}
    />
  );
}
