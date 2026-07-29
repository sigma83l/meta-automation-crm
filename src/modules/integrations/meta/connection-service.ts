import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { getServerEnvironment } from "@/src/lib/env";
import {
  assertWorkspaceManager,
  type TrustedWorkspace
} from "@/src/modules/workspaces/server/resolve-workspace";
import type { MetaChannel } from "./contracts";
import { encryptCredential } from "@/src/modules/ai/credential-vault";
import { createSignedMetaOauthState, verifySignedMetaOauthState } from "./oauth-state";
import {
  exchangeAndVerifyMetaCredential,
  type LiveMetaExchangeInput
} from "./live-connection-adapter";

const requiredPermissions = {
  whatsapp: ["whatsapp_business_management", "whatsapp_business_messaging"],
  instagram: ["instagram_business_basic", "instagram_business_manage_messages"]
} as const;
export async function listMetaConnections(workspace: TrustedWorkspace) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("meta_connections")
    .select(
      "id,channel,mode,status,provider_account_id,display_name,waba_id,phone_number_id,instagram_account_id,permissions,webhook_message_subscribed,webhook_comment_subscribed,token_masked_suffix,token_expires_at,last_health_status,last_health_checked_at"
    )
    .eq("workspace_id", workspace.id)
    .order("channel");
  if (error) throw new Error("Connections unavailable.");
  return data ?? [];
}
export async function connectSandbox(workspace: TrustedWorkspace, channel: MetaChannel) {
  assertWorkspaceManager(workspace);
  const admin = createSupabaseAdminClient();
  const account =
    channel === "whatsapp" ? `wa-sandbox-${workspace.id}` : `ig-sandbox-${workspace.id}`;
  const row = {
    workspace_id: workspace.id,
    channel,
    mode: "sandbox",
    status: "active",
    provider_account_id: account,
    display_name: `${channel === "whatsapp" ? "WhatsApp" : "Instagram"} Sandbox`,
    permissions: [...requiredPermissions[channel]],
    webhook_message_subscribed: true,
    webhook_comment_subscribed: channel === "instagram",
    last_health_status: "healthy",
    last_health_checked_at: new Date().toISOString(),
    waba_id: channel === "whatsapp" ? `waba-sandbox-${workspace.id}` : null,
    phone_number_id: channel === "whatsapp" ? account : null,
    instagram_account_id: channel === "instagram" ? account : null
  };
  const { data, error } = await admin
    .from("meta_connections")
    .upsert(row, { onConflict: "workspace_id,channel" })
    .select("id")
    .single();
  if (error) throw new Error("Sandbox connection failed.");
  await admin.from("meta_connection_audit_events").insert({
    workspace_id: workspace.id,
    actor_id: workspace.userId,
    connection_id: data.id,
    event_type: "connection.sandbox_connected",
    safe_details: { channel }
  });
  return { id: data.id, channel, status: "active", mode: "sandbox" };
}
export async function updateMetaConnection(
  workspace: TrustedWorkspace,
  channel: MetaChannel,
  action: "health" | "reauthorize" | "disconnect"
) {
  assertWorkspaceManager(workspace);
  const admin = createSupabaseAdminClient();
  const update =
    action === "disconnect"
      ? { status: "disconnected", last_health_status: "unknown" }
      : action === "reauthorize"
        ? { status: "reauth_required", last_health_status: "expired" }
        : { last_health_status: "healthy", last_health_checked_at: new Date().toISOString() };
  const { data, error } = await admin
    .from("meta_connections")
    .update(update)
    .eq("workspace_id", workspace.id)
    .eq("channel", channel)
    .select("id")
    .single();
  if (error) throw new Error("Connection update failed.");
  await admin.from("meta_connection_audit_events").insert({
    workspace_id: workspace.id,
    actor_id: workspace.userId,
    connection_id: data.id,
    event_type: `connection.${action}`,
    safe_details: { channel }
  });
  return { channel, action };
}
export async function createMetaOauthState(workspaceId: string, channel: MetaChannel) {
  const env = getServerEnvironment();
  if (!env.metaAppSecret) throw new Error("Meta connection is not configured.");
  const issuedAt = Date.now();
  const state = createSignedMetaOauthState(workspaceId, channel, env.metaAppSecret, issuedAt);
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("meta_oauth_nonces").upsert(
    {
      workspace_id: workspaceId,
      channel,
      state_hash: createHash("sha256").update(state).digest("hex"),
      expires_at: new Date(issuedAt + 600_000).toISOString(),
      consumed_at: null
    },
    { onConflict: "workspace_id,channel" }
  );
  if (error) throw new Error("Meta connection state could not be stored.");
  return state;
}
export function verifyMetaOauthState(
  state: string,
  workspaceId: string,
  channel: MetaChannel,
  maxAgeMs = 600_000
) {
  const env = getServerEnvironment();
  if (!env.metaAppSecret) return false;
  return verifySignedMetaOauthState(
    state,
    workspaceId,
    channel,
    env.metaAppSecret,
    Date.now(),
    maxAgeMs
  );
}
export async function consumeMetaOauthState(
  state: string,
  workspaceId: string,
  channel: MetaChannel
) {
  if (!verifyMetaOauthState(state, workspaceId, channel)) return false;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("consume_meta_oauth_nonce", {
    p_workspace_id: workspaceId,
    p_channel: channel,
    p_state_hash: createHash("sha256").update(state).digest("hex")
  });
  return !error && data === true;
}
export function liveMetaReadiness() {
  const env = getServerEnvironment();
  const ready =
    env.metaConnectionMode === "live" &&
    Boolean(
      env.metaAppId &&
      env.metaAppSecret &&
      env.metaOauthRedirectUrl &&
      env.metaGraphApiVersion &&
      env.metaWhatsappConfigId
    );
  return {
    ready,
    status: ready
      ? ("READY_FOR_META_AUTHORIZATION" as const)
      : ("LIVE_MULTI_BUSINESS_BLOCKED_BY_META" as const)
  };
}

export async function createLiveMetaConnection(
  workspace: TrustedWorkspace,
  input: LiveMetaExchangeInput
) {
  assertWorkspaceManager(workspace);
  const credential = await exchangeAndVerifyMetaCredential(input, getServerEnvironment());
  return storeLiveMetaConnection(workspace, {
    channel: input.channel,
    providerAccountId: credential.providerAccountId,
    displayName: credential.displayName,
    accessToken: credential.accessToken,
    permissions: credential.permissions,
    ...(credential.wabaId ? { wabaId: credential.wabaId } : {}),
    ...(credential.phoneNumberId ? { phoneNumberId: credential.phoneNumberId } : {}),
    ...(credential.instagramAccountId ? { instagramAccountId: credential.instagramAccountId } : {})
  });
}
export async function storeLiveMetaConnection(
  workspace: TrustedWorkspace,
  input: {
    channel: MetaChannel;
    providerAccountId: string;
    displayName: string;
    accessToken: string;
    permissions: readonly string[];
    wabaId?: string;
    phoneNumberId?: string;
    instagramAccountId?: string;
    expiresAt?: string;
  }
) {
  assertWorkspaceManager(workspace);
  const env = getServerEnvironment();
  if (!env.credentialEncryptionKey) throw new Error("Token encryption is unavailable.");
  const required = requiredPermissions[input.channel];
  if (required.some((permission) => !input.permissions.includes(permission)))
    throw new Error("Required Meta permission is missing.");
  const token = encryptCredential(input.accessToken, env.credentialEncryptionKey);
  const admin = createSupabaseAdminClient();
  const row = {
    workspace_id: workspace.id,
    channel: input.channel,
    mode: "live",
    status: "active",
    provider_account_id: input.providerAccountId,
    display_name: input.displayName,
    permissions: [...input.permissions],
    webhook_message_subscribed: true,
    webhook_comment_subscribed: false,
    token_ciphertext: token.ciphertext,
    token_iv: token.iv,
    token_auth_tag: token.authTag,
    token_key_version: token.keyVersion,
    token_masked_suffix: token.maskedSuffix,
    token_expires_at: input.expiresAt ?? null,
    last_health_status: "healthy",
    last_health_checked_at: new Date().toISOString(),
    waba_id: input.wabaId ?? null,
    phone_number_id: input.phoneNumberId ?? null,
    instagram_account_id: input.instagramAccountId ?? null
  };
  const { data, error } = await admin
    .from("meta_connections")
    .upsert(row, { onConflict: "workspace_id,channel" })
    .select("id")
    .single();
  if (error) throw new Error("Live connection storage failed.");
  await admin.from("meta_connection_audit_events").insert({
    workspace_id: workspace.id,
    actor_id: workspace.userId,
    connection_id: data.id,
    event_type: "connection.live_stored",
    safe_details: { channel: input.channel, permissions: [...input.permissions] }
  });
  return { id: data.id, channel: input.channel, status: "active" };
}
