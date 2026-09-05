import { notFound } from "next/navigation";

import { recordWorkspaceView } from "@/src/modules/platform-admin/server/audit";
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

  // After the workspace is known to exist and before any of it reaches the
  // browser. This screen is the console's one cross-tenant read of a named
  // customer, and the ledger line is what makes it answerable afterwards.
  //
  // Deliberately not before the load: `target_workspace_id` references
  // `workspaces`, so a probed id would fail the insert rather than the lookup —
  // and a console that wrote a ledger line for every guessed URL would fill the
  // record with reads that never happened.
  //
  // It fails closed. Nothing here is caught, so a ledger that cannot accept the
  // line takes the screen with it rather than serving customer data
  // unrecorded — the same bargain every other action in this module makes.
  await recordWorkspaceView(runtime, id);

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
