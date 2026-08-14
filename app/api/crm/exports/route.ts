import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireCsrf } from "@/src/modules/auth/security/route";
import { createCrmRuntime } from "@/src/modules/crm/runtime";
import { buildCrmExport } from "@/src/modules/exports/export-builder";
import { ExportRepository } from "@/src/modules/exports/export-repository";
import { getServerEnvironment } from "@/src/lib/env";
import { billingBlockedResponse } from "@/src/modules/billing/http";

const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("one"), customerId: z.uuid() }),
  z.object({ kind: z.literal("selected"), customerIds: z.array(z.uuid()).min(1).max(250) }),
  z.object({
    kind: z.literal("filtered"),
    query: z.string().max(80).optional(),
    status: z.enum(["active", "archived"]).optional()
  }),
  z.object({ kind: z.literal("workspace") })
]);

export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  let runtime: Awaited<ReturnType<typeof createCrmRuntime>>;
  try {
    runtime = await createCrmRuntime();
  } catch (error) {
    return billingBlockedResponse(error, "EXPORT_UNAVAILABLE", 403);
  }
  const { client, workspace } = runtime;
  const parsedScope = scopeSchema.safeParse(await request.json());
  if (!parsedScope.success) {
    return NextResponse.json({ error: "INVALID_EXPORT_SCOPE" }, { status: 400 });
  }
  const scope = parsedScope.data;
  const created = await client
    .from("export_jobs")
    .insert({
      workspace_id: workspace.id,
      requested_by: workspace.userId,
      scope: scope.kind,
      status: "processing",
      filter_snapshot: scope
    })
    .select("id")
    .single();
  if (created.error) return NextResponse.json({ error: "EXPORT_UNAVAILABLE" }, { status: 400 });
  let uploadedPath: string | undefined;
  try {
    const dataset = await new ExportRepository(client, workspace).collect(scope);
    const artifact = await buildCrmExport(dataset);
    const environment = getServerEnvironment();
    if (artifact.zip.byteLength > environment.crmExportMaxBytes)
      throw new Error("EXPORT_SIZE_LIMIT");
    const date = dataset.generatedAt.slice(0, 10);
    const path = `${workspace.id}/${created.data.id}/crm-export-${date}.zip`;
    const upload = await client.storage
      .from("crm-exports")
      .upload(path, artifact.zip, { contentType: "application/zip" });
    if (upload.error) throw upload.error;
    uploadedPath = path;
    const expiresAt = new Date(Date.now() + environment.crmExportTtlSeconds * 1000).toISOString();
    await client
      .from("export_jobs")
      .update({
        status: "ready",
        object_path: path,
        row_count: dataset.sheets.Customers?.length ?? 0,
        file_count: dataset.attachments.length,
        byte_size: artifact.zip.byteLength,
        expires_at: expiresAt,
        completed_at: new Date().toISOString()
      })
      .eq("id", created.data.id);
    await client.from("crm_audit_events").insert({
      workspace_id: workspace.id,
      actor_user_id: workspace.userId,
      action: "crm.export.created",
      metadata: { export_job_id: created.data.id, scope: scope.kind }
    });
    return NextResponse.json({ jobId: created.data.id, expiresAt }, { status: 201 });
  } catch {
    if (uploadedPath) await client.storage.from("crm-exports").remove([uploadedPath]);
    await client
      .from("export_jobs")
      .update({ status: "failed", error_code: "EXPORT_FAILED" })
      .eq("id", created.data.id);
    return NextResponse.json({ error: "EXPORT_FAILED" }, { status: 400 });
  }
}
