import { notFound } from "next/navigation";

import {
  loadPlatformOverview,
  maskedEmailsFor
} from "@/src/modules/platform-admin/server/directory";
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

  // Who is holding each open window. A display name where the profile has one,
  // the masked address otherwise — the same pair the staff screen shows, since
  // this is the same question asked from the other end.
  const holderIds = [...new Set(grants.map((grant) => grant.adminId))];
  const [holderEmails, holderProfiles] = await Promise.all([
    maskedEmailsFor(runtime, holderIds),
    holderIds.length
      ? runtime.db.from("profiles").select("id,display_name").in("id", holderIds)
      : Promise.resolve({ data: [] })
  ]);
  const holderNames = new Map(
    (holderProfiles.data ?? []).map((row) => [String(row.id), row.display_name as string | null])
  );
  const grantHolders = Object.fromEntries(
    holderIds.map((id) => [id, holderNames.get(id) ?? holderEmails[id] ?? id])
  );

  return (
    <PlatformOverviewPanel
      role={runtime.admin.role}
      overview={overview}
      liveGrants={grants}
      grantHolders={grantHolders}
    />
  );
}
