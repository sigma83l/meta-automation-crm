import type { Result } from "@/src/lib/result";
export type MetaChannel = "whatsapp" | "instagram";
export type MetaConnectionStatus =
  "pending" | "active" | "disabled" | "reauth_required" | "disconnected";
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
