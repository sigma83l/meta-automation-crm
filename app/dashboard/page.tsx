import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import DashboardOverview from "@/src/modules/workspaces/ui/dashboard-overview";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const client = await createSupabaseServerClient();
  const { data } = await client.from("onboarding_states").select("auth_completed_at").maybeSingle();
  if (!data?.auth_completed_at) redirect("/onboarding");
  return <DashboardOverview />;
}
