import type { Result } from "@/src/lib/result";
export type MetaChannel = "whatsapp" | "instagram";
export type MetaConnectionStatus =
  | "pending"
  | "active"
  /** Live but impaired: refresh failures, elevated errors, partial capability. */
  | "degraded"
  /** The provider has restricted the account; sending is not permitted. */
  | "policy_blocked"
  | "disabled"
  | "reauth_required"
  | "disconnected";

/** States that accept inbound. Degraded is impaired, not absent. */
export const LIVE_META_CONNECTION_STATUSES = ["active", "degraded"] as const;

export function acceptsInbound(status: MetaConnectionStatus): boolean {
  return (LIVE_META_CONNECTION_STATUSES as readonly string[]).includes(status);
}

/**
 * Whether an outbound send may be attempted at all.
 *
 * Narrower than inbound on purpose: a degraded connection should still record
 * what the customer said, but a provider that has restricted the account must
 * not be sent to, and an impaired one is not a safe target either.
 */
export function permitsOutbound(status: MetaConnectionStatus): boolean {
  return status === "active";
}
export type AttachmentMetadata = Readonly<{
  providerMediaId: string;
  kind: "image" | "video" | "audio" | "document";
  mimeType?: string;
  filename?: string;
  downloadState: "pending";
}>;
export type NormalizedMetaEvent = Readonly<{
  providerEventId: string;
  providerAccountId: string;
  channel: MetaChannel;
  type: "message" | "message_status" | "comment" | "private_reply";
  senderRef?: string;
  providerMessageRef?: string;
  text?: string;
  attachments: readonly AttachmentMetadata[];
  status?: "delivered" | "read" | "failed";
  occurredAt: string;
}>;
export type ConnectionMetadata = Readonly<{
  id: string;
  workspaceId: string;
  channel: MetaChannel;
  mode: "sandbox" | "live";
  status: MetaConnectionStatus;
  providerAccountId: string;
  displayName: string;
  permissions: readonly string[];
  webhookMessageSubscribed: boolean;
  webhookCommentSubscribed: boolean;
  tokenMaskedSuffix?: string;
  health: "unknown" | "healthy" | "degraded" | "expired";
}>;
export interface MetaConnectionAdapter {
  readonly channel: MetaChannel;
  startConnection(
    state: string
  ): Promise<Result<{ authorizationUrl?: string; state: string; blocked?: true }>>;
  exchangeCallback(
    code: string
  ): Promise<
    Result<{ providerAccountId: string; accessToken: string; permissions: readonly string[] }>
  >;
  testConnection(): Promise<Result<{ healthy: boolean }>>;
}
export interface ProviderMediaDownloader {
  download(input: {
    connectionId: string;
    providerMediaId: string;
    workspaceId: string;
  }): Promise<Result<{ bytes: Uint8Array; mimeType: string }>>;
}
