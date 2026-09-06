import { NextResponse, type NextRequest } from "next/server";

import { createCrmRuntime } from "@/src/modules/crm/runtime";
import { isExportExpired } from "@/src/modules/exports/export-policy";
import { billingBlockedResponse } from "@/src/modules/billing/http";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let runtime: Awaited<ReturnType<typeof createCrmRuntime>>;
  try {
    runtime = await createCrmRuntime();
  } catch (error) {
    return billingBlockedResponse(error, "EXPORT_NOT_AVAILABLE", 404);
  }
  const { client, workspace } = runtime;
  const job = await client
    .from("export_jobs")
    .select("status,object_path,expires_at")
    .eq("workspace_id", workspace.id)
    .eq("id", (await params).id)
    .single();
  if (job.error || job.data.status !== "ready" || !job.data.object_path || !job.data.expires_at) {
    return NextResponse.json({ error: "EXPORT_NOT_AVAILABLE" }, { status: 404 });
  }
  if (isExportExpired(job.data.expires_at)) {
    await client.storage.from("crm-exports").remove([job.data.object_path]);
    await client
      .from("export_jobs")
      .update({ status: "expired" })
      .eq("id", (await params).id);
    return NextResponse.json({ error: "EXPORT_EXPIRED" }, { status: 410 });
  }
  const signed = await client.storage
    .from("crm-exports")
    .createSignedUrl(job.data.object_path, 60, {
      download: true
    });
  return signed.error
    ? NextResponse.json({ error: "EXPORT_NOT_AVAILABLE" }, { status: 404 })
    : NextResponse.json({ url: signed.data.signedUrl, expiresIn: 60 });
}
