import { notFound } from "next/navigation";

import {
  loadFlagCatalogue,
  loadPlanDefaults
} from "@/src/modules/platform-admin/server/feature-flags";
import {
  createPlatformAdminRuntime,
  PlatformAdminError
} from "@/src/modules/platform-admin/server/runtime";
import { FeatureCatalogue } from "@/src/modules/platform-admin/ui/feature-catalogue";

export const dynamic = "force-dynamic";

export default async function AdminFeaturesPage() {
  let runtime;
  try {
    runtime = await createPlatformAdminRuntime("read");
  } catch (error) {
    if (error instanceof PlatformAdminError) notFound();
    throw error;
  }

  const [catalogue, plans, overrides] = await Promise.all([
    loadFlagCatalogue(runtime),
    loadPlanDefaults(runtime),
    runtime.db.from("workspace_feature_overrides").select("flag_key")
  ]);

  const overrideCounts: Record<string, number> = {};
  for (const row of overrides.data ?? []) {
    const key = String(row.flag_key);
    overrideCounts[key] = (overrideCounts[key] ?? 0) + 1;
  }

  return (
    <FeatureCatalogue
      role={runtime.admin.role}
      catalogue={catalogue.map((entry) => ({
        key: entry.key,
        displayName: entry.display_name,
        description: entry.description,
        defaultEnabled: entry.default_enabled
      }))}
      plans={plans}
      overrideCounts={overrideCounts}
    />
  );
}
