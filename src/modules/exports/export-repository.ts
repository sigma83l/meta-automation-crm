import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getServerEnvironment } from "@/src/lib/env";
import { safeArchivePath } from "@/src/modules/crm/media/media-policy";
import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import type { ExportDataset, ExportScope } from "./contracts";

const tableSheets = {
  Customers: "customers",
  "Channel Identities": "customer_channel_identities",
  "Custom Fields": "customer_custom_field_values",
  Consents: "customer_consents",
  Tags: "customer_tag_assignments",
  Conversations: "conversations",
  Messages: "messages",
  Automations: "customer_automation_references",
  Executions: "customer_automation_references",
  Timeline: "customer_activities"
} as const;

export class ExportRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly workspace: TrustedWorkspace
  ) {}

  async collect(scope: ExportScope): Promise<ExportDataset> {
    const environment = getServerEnvironment();
    const customerIds = await this.resolveCustomerIds(scope);
    if (customerIds.length > environment.crmExportMaxRows) throw new Error("EXPORT_ROW_LIMIT");
    const sheets: Record<string, readonly Record<string, unknown>[]> = {};
    for (const [sheet, table] of Object.entries(tableSheets)) {
      let query = this.client.from(table).select("*").eq("workspace_id", this.workspace.id);
      if (customerIds.length === 0) {
        sheets[sheet] = [];
        continue;
      }
      if (table === "customers") query = query.in("id", customerIds);
      else query = query.in("customer_id", customerIds);
      const { data, error } = await query.limit(environment.crmExportMaxRows + 1);
      if (error) throw error;
      if ((data?.length ?? 0) > environment.crmExportMaxRows) throw new Error("EXPORT_ROW_LIMIT");
      sheets[sheet] = (data ?? []).map(stripInternal);
    }

    const filesResult = await this.client
      .from("customer_files")
      .select("customer_id,object_path,original_name,safe_name,mime_type,sha256")
      .eq("workspace_id", this.workspace.id)
      .is("deleted_at", null)
      .in("customer_id", customerIds)
      .limit(environment.crmExportMaxFiles + 1);
    if (filesResult.error) throw filesResult.error;
    if ((filesResult.data?.length ?? 0) > environment.crmExportMaxFiles) {
      throw new Error("EXPORT_FILE_LIMIT");
    }
    const attachments = [];
    let totalBytes = 0;
    for (const file of filesResult.data ?? []) {
      safeArchivePath(file.customer_id, file.safe_name);
      const downloaded = await this.client.storage
        .from("customer-media")
        .download(file.object_path);
      if (downloaded.error) throw downloaded.error;
      const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
      totalBytes += bytes.byteLength;
      if (totalBytes > environment.crmExportMaxBytes) throw new Error("EXPORT_SIZE_LIMIT");
      attachments.push({
        customerId: file.customer_id,
        originalName: file.original_name,
        safeName: file.safe_name,
        objectPath: file.object_path,
        mimeType: file.mime_type,
        sha256: file.sha256,
        bytes
      });
    }
    sheets.Attachments = (filesResult.data ?? []).map((file) => ({
      customer_id: file.customer_id,
      original_name: file.original_name,
      mime_type: file.mime_type,
      sha256: file.sha256,
      zip_path: safeArchivePath(file.customer_id, file.safe_name)
    }));
    return {
      workspaceId: this.workspace.id,
      generatedAt: new Date().toISOString(),
      sheets,
      attachments
    };
  }

  private async resolveCustomerIds(scope: ExportScope) {
    let query = this.client.from("customers").select("id").eq("workspace_id", this.workspace.id);
    if (scope.kind === "one") query = query.eq("id", scope.customerId);
    if (scope.kind === "selected") query = query.in("id", [...scope.customerIds]);
    if (scope.kind === "filtered") {
      if (scope.status) query = query.eq("status", scope.status);
      if (scope.query) {
        const safe = scope.query.replaceAll(/[,%()]/g, "").slice(0, 80);
        query = query.or(`display_name.ilike.%${safe}%,company_name.ilike.%${safe}%`);
      }
    }
    const { data, error } = await query.limit(getServerEnvironment().crmExportMaxRows + 1);
    if (error) throw error;
    return (data ?? []).map((row) => row.id);
  }
}

function stripInternal(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => !/(token|secret|password|session|credential|prompt|webhook)/i.test(key))
      .map(([key, value]) => [key, sanitizeValue(value)])
  );
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/(token|secret|password|session|credential|prompt|webhook)/i.test(key))
        .map(([key, nested]) => [key, sanitizeValue(nested)])
    );
  }
  return value;
}
