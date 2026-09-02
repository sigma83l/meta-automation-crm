import { notFound } from "next/navigation";

import { listPlans } from "@/src/modules/platform-admin/server/billing-overrides";
import {
  loadWorkspaceDetail,
  maskedEmailsFor
} from "@/src/modules/platform-admin/server/directory";
import { activeGrantFor } from "@/src/modules/platform-admin/server/impersonation";
import {
  createPlatformAdminRuntime,
  PlatformAdminError
} from "@/src/modules/platform-admin/server/runtime";
import { WorkspaceDetailPanel } from "@/src/modules/platform-admin/ui/workspace-detail";

export const dynamic = "force-dynamic";

export default async function AdminWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  let runtime;
  try {
    runtime = await createPlatformAdminRuntime("read");
  } catch (error) {
    if (error instanceof PlatformAdminError) notFound();
    throw error;
  }
  const { id } = await params;
  const detail = await loadWorkspaceDetail(runtime, id).catch(() => null);
  if (!detail) notFound();

  const [plans, maskedEmails, grant] = await Promise.all([
    listPlans(runtime).catch(() => []),
    maskedEmailsFor(
      runtime,
      detail.members.map((member) => member.userId)
    ),
    activeGrantFor(runtime, id)
  ]);

  return (
    <WorkspaceDetailPanel
      role={runtime.admin.role}
      detail={detail}
      plans={plans}
      maskedEmails={maskedEmails}
      grant={grant}
    />
  );
}
