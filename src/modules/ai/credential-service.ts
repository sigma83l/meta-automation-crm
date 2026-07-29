import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServerEnvironment } from "@/src/lib/env";
import {
  assertWorkspaceManager,
  type TrustedWorkspace
} from "@/src/modules/workspaces/server/resolve-workspace";
import { decryptCredential, encryptCredential } from "./credential-vault";

type Provider = "gemini" | "openai" | "anthropic";
function adminClient() {
  const env = getServerEnvironment();
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey)
    throw new Error("Server credential storage is unavailable.");
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false }
  });
}
function masterKey() {
  const value = getServerEnvironment().credentialEncryptionKey;
  if (!value) throw new Error("Credential encryption is unavailable.");
  return value;
}
export async function storeWorkspaceCredential(
  workspace: TrustedWorkspace,
  provider: Provider,
  plaintext: string
) {
  assertWorkspaceManager(workspace);
  const admin = adminClient();
  const existing = await admin
    .from("workspace_ai_credentials")
    .select("key_version")
    .eq("workspace_id", workspace.id)
    .eq("provider", provider)
    .maybeSingle();
  const envelope = encryptCredential(plaintext, masterKey(), (existing.data?.key_version ?? 0) + 1);
  const { error } = await admin.from("workspace_ai_credentials").upsert(
    {
      workspace_id: workspace.id,
      provider,
      ciphertext: envelope.ciphertext,
      iv: envelope.iv,
      auth_tag: envelope.authTag,
      key_version: envelope.keyVersion,
      masked_suffix: envelope.maskedSuffix,
      status: "untested",
      rotated_at: existing.data ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    },
    { onConflict: "workspace_id,provider" }
  );
  if (error) throw new Error("Credential could not be stored.");
  await audit(admin, workspace, "credential.stored", provider, "success");
  return {
    provider,
    status: "untested",
    maskedSuffix: envelope.maskedSuffix,
    keyVersion: envelope.keyVersion
  };
}
export async function testWorkspaceCredential(workspace: TrustedWorkspace, provider: Provider) {
  assertWorkspaceManager(workspace);
  const admin = adminClient();
  const { data, error } = await admin
    .from("workspace_ai_credentials")
    .select("ciphertext,iv,auth_tag")
    .eq("workspace_id", workspace.id)
    .eq("provider", provider)
    .single();
  if (error || !data) throw new Error("Credential is unavailable.");
  decryptCredential(
    { ciphertext: data.ciphertext, iv: data.iv, authTag: data.auth_tag },
    masterKey()
  );
  await admin
    .from("workspace_ai_credentials")
    .update({ status: "active", tested_at: new Date().toISOString() })
    .eq("workspace_id", workspace.id)
    .eq("provider", provider);
  await audit(admin, workspace, "credential.tested", provider, "success");
  return { provider, status: "active" };
}
export async function deleteWorkspaceCredential(workspace: TrustedWorkspace, provider: Provider) {
  assertWorkspaceManager(workspace);
  const admin = adminClient();
  await admin
    .from("workspace_ai_credentials")
    .delete()
    .eq("workspace_id", workspace.id)
    .eq("provider", provider);
  await admin
    .from("business_profiles")
    .update({ ai_mode: "PLATFORM_PAID_DEFAULT", demo_mode_enabled: false })
    .eq("workspace_id", workspace.id);
  await audit(admin, workspace, "credential.deleted", provider, "success");
}
async function audit(
  admin: ReturnType<typeof adminClient>,
  workspace: TrustedWorkspace,
  eventType: string,
  provider: Provider,
  status: string
) {
  await admin.from("ai_execution_audit_events").insert({
    workspace_id: workspace.id,
    actor_id: workspace.userId,
    event_type: eventType,
    provider,
    status,
    safe_details: {}
  });
}
