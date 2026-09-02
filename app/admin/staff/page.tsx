import { notFound } from "next/navigation";

import { maskedEmailsFor } from "@/src/modules/platform-admin/server/directory";
import {
  createPlatformAdminRuntime,
  PlatformAdminError
} from "@/src/modules/platform-admin/server/runtime";
import { listStaff } from "@/src/modules/platform-admin/server/staff";
import { StaffPanel } from "@/src/modules/platform-admin/ui/staff-panel";

export const dynamic = "force-dynamic";

export default async function AdminStaffPage() {
  let runtime;
  try {
    runtime = await createPlatformAdminRuntime("staff");
  } catch (error) {
    if (error instanceof PlatformAdminError) notFound();
    throw error;
  }

  const staff = await listStaff(runtime);
  const ids = staff.map((member) => member.userId);
  const [maskedEmails, profiles] = await Promise.all([
    maskedEmailsFor(runtime, ids),
    ids.length
      ? runtime.db.from("profiles").select("id,display_name").in("id", ids)
      : Promise.resolve({ data: [] })
  ]);
  const nameById = new Map(
    (profiles.data ?? []).map((row) => [String(row.id), row.display_name as string | null])
  );

  return (
    <StaffPanel
      role={runtime.admin.role}
      currentUserId={runtime.admin.userId}
      staff={staff.map((member) => ({
        userId: member.userId,
        role: member.role,
        status: member.status,
        displayName: nameById.get(member.userId) ?? null,
        maskedEmail: maskedEmails[member.userId] ?? "—",
        grantedReason: member.grantedReason,
        createdAt: member.createdAt
      }))}
    />
  );
}
