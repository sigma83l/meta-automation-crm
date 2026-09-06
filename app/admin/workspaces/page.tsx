import { notFound } from "next/navigation";

import { listWorkspaces } from "@/src/modules/platform-admin/server/directory";
import {
  createPlatformAdminRuntime,
  PlatformAdminError
} from "@/src/modules/platform-admin/server/runtime";
import { WorkspaceDirectory } from "@/src/modules/platform-admin/ui/workspace-directory";

export const dynamic = "force-dynamic";

export default async function AdminWorkspacesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let runtime;
  try {
    runtime = await createPlatformAdminRuntime("read");
  } catch (error) {
    if (error instanceof PlatformAdminError) notFound();
    throw error;
  }
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const status = params.status === "active" || params.status === "disabled" ? params.status : "";
  const workspaces = await listWorkspaces(runtime, {
    ...(query ? { query } : {}),
    ...(status ? { status } : {})
  });
  return (
    <WorkspaceDirectory
      role={runtime.admin.role}
      workspaces={workspaces}
      query={query}
      status={status}
    />
  );
}
