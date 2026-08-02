import "server-only";

import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import {
  assertWorkspaceOperator,
  type TrustedWorkspace
} from "@/src/modules/workspaces/server/resolve-workspace";
import { parseCrmCsv } from "./csv-import";

export async function importCrmCsv(workspace: TrustedWorkspace, sourceName: string, csv: string) {
  assertWorkspaceOperator(workspace);
  const safeSourceName = sourceName
    .trim()
    .replaceAll(/[/\\\u0000-\u001f]/g, "_")
    .slice(0, 160);
  if (!safeSourceName.toLowerCase().endsWith(".csv")) throw new Error("IMPORT_FILE_TYPE");
  const rows = parseCrmCsv(csv);
  const admin = await createSupabaseAdminClient();
  const { data, error } = await admin.rpc("import_crm_rows", {
    trusted_workspace_id: workspace.id,
    trusted_requested_by: workspace.userId,
    requested_source_name: safeSourceName,
    requested_rows: rows
  });
  if (error || !Array.isArray(data) || !data[0]) throw new Error("IMPORT_FAILED");
  return {
    jobId: String(data[0].job_id),
    status: String(data[0].job_status),
    acceptedRows: Number(data[0].accepted_rows),
    rejectedRows: Number(data[0].rejected_rows)
  };
}
