import { notFound } from "next/navigation";

import { listPlatformAudit } from "@/src/modules/platform-admin/server/audit";
import { workspaceNamesFor } from "@/src/modules/platform-admin/server/directory";
import { listRecentImpersonations } from "@/src/modules/platform-admin/server/impersonation";
import {
  createPlatformAdminRuntime,
  PlatformAdminError
} from "@/src/modules/platform-admin/server/runtime";
import { AuditLog } from "@/src/modules/platform-admin/ui/audit-log";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  let runtime;
  try {
    runtime = await createPlatformAdminRuntime("read");
  } catch (error) {
    if (error instanceof PlatformAdminError) notFound();
    throw error;
  }
  const [events, grants] = await Promise.all([
    listPlatformAudit(runtime, { limit: 200 }),
    listRecentImpersonations(runtime, 50)
  ]);
  // Named after the ledger is read, not stored alongside it: the ledger records
  // the reference, and the name is whatever that workspace is called now.
  const workspaceNames = await workspaceNamesFor(
    runtime,
    events.flatMap((event) => (event.targetWorkspaceId ? [event.targetWorkspaceId] : []))
  );
  return (
    <AuditLog
      role={runtime.admin.role}
      events={events}
      grants={grants}
      workspaceNames={workspaceNames}
      renderedAt={new Date().toISOString()}
    />
  );
}
