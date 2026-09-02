import { notFound } from "next/navigation";

import { loadPlatformOverview } from "@/src/modules/platform-admin/server/directory";
import { listActiveImpersonations } from "@/src/modules/platform-admin/server/impersonation";
import {
  createPlatformAdminRuntime,
  PlatformAdminError
} from "@/src/modules/platform-admin/server/runtime";
import { PlatformOverviewPanel } from "@/src/modules/platform-admin/ui/platform-overview";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  let runtime;
  try {
    runtime = await createPlatformAdminRuntime("read");
  } catch (error) {
    if (error instanceof PlatformAdminError) notFound();
    throw error;
  }
  // The overview is allowed to be unavailable without taking the page with it:
  // a null renders as em dashes, which is honest, whereas zeroes would claim
  // every queue is empty on the strength of a read that failed.
  const [overview, grants] = await Promise.all([
    loadPlatformOverview(runtime).catch(() => null),
    listActiveImpersonations(runtime).catch(() => [])
  ]);
  return (
    <PlatformOverviewPanel role={runtime.admin.role} overview={overview} liveGrants={grants} />
  );
}
