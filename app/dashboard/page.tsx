import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { DashboardOverview } from "@/src/modules/workspaces/ui/dashboard-overview";
import { resolveTrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const client = await createSupabaseServerClient();
  const { data } = await client.from("onboarding_states").select("auth_completed_at").maybeSingle();
  if (!data?.auth_completed_at) redirect("/onboarding");
  const workspace = await resolveTrustedWorkspace(client);
  const [automations, windows, customers, reviews, errors, connections] = await Promise.all([
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
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("requires_human_review", true),
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
      metrics={{
        automations: automations.count ?? 0,
        windows: windows.count ?? 0,
        customers: customers.count ?? 0,
        reviews: reviews.count ?? 0,
        errors: errors.count ?? 0,
        whatsapp: health("whatsapp"),
        instagram: health("instagram")
      }}
    />
  );
}
