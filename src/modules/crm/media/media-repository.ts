import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getServerEnvironment } from "@/src/lib/env";
import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import { validateMedia } from "./media-policy";

export class MediaRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly workspace: TrustedWorkspace
  ) {}

  async upload(customerId: string, bytes: Uint8Array, originalName: string) {
    const media = await validateMedia(bytes, originalName, getServerEnvironment().crmMediaMaxBytes);
    const objectPath = `${this.workspace.id}/${customerId}/${media.safeName}`;
    const uploaded = await this.client.storage
      .from("customer-media")
      .upload(objectPath, media.bytes, { contentType: media.mimeType, upsert: false });
    if (uploaded.error) throw uploaded.error;
    const inserted = await this.client
      .from("customer_files")
      .insert({
        workspace_id: this.workspace.id,
        customer_id: customerId,
        object_path: objectPath,
        original_name: media.originalName,
        safe_name: media.safeName,
        mime_type: media.mimeType,
        byte_size: media.byteSize,
        sha256: media.sha256,
        created_by: this.workspace.userId
      })
      .select("*")
      .single();
    if (inserted.error) {
      await this.client.storage.from("customer-media").remove([objectPath]);
      throw inserted.error;
    }
    await this.client.from("crm_audit_events").insert({
      workspace_id: this.workspace.id,
      actor_user_id: this.workspace.userId,
      customer_id: customerId,
      action: "crm.file.uploaded",
      metadata: { file_id: inserted.data.id, mime_type: media.mimeType }
    });
    return inserted.data;
  }

  async signedDownload(fileId: string, expiresIn = 60) {
    const file = await this.client
      .from("customer_files")
      .select("object_path,deleted_at")
      .eq("workspace_id", this.workspace.id)
      .eq("id", fileId)
      .single();
    if (file.error || file.data.deleted_at) throw new Error("FILE_NOT_AVAILABLE");
    const signed = await this.client.storage
      .from("customer-media")
      .createSignedUrl(file.data.object_path, Math.min(expiresIn, 300), { download: true });
    if (signed.error) throw signed.error;
    return signed.data.signedUrl;
  }

  async remove(fileId: string) {
    const file = await this.client
      .from("customer_files")
      .select("object_path")
      .eq("workspace_id", this.workspace.id)
      .eq("id", fileId)
      .single();
    if (file.error) throw file.error;
    const removed = await this.client.storage
      .from("customer-media")
      .remove([file.data.object_path]);
    if (removed.error) throw removed.error;
    const updated = await this.client
      .from("customer_files")
      .update({ deleted_at: new Date().toISOString() })
      .eq("workspace_id", this.workspace.id)
      .eq("id", fileId);
    if (updated.error) throw updated.error;
    await this.client.from("crm_audit_events").insert({
      workspace_id: this.workspace.id,
      actor_user_id: this.workspace.userId,
      action: "crm.file.deleted",
      metadata: { file_id: fileId }
    });
  }
}
