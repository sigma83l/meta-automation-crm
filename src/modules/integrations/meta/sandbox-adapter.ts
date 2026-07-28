import { appError, err, ok } from "@/src/lib/result";
import type { MetaChannel, MetaConnectionAdapter, NormalizedMetaEvent } from "./contracts";
export function createSandboxMetaConnectionAdapter(
  channel: MetaChannel,
  options: { expired?: boolean } = {}
): MetaConnectionAdapter {
  return Object.freeze({
    channel,
    async startConnection(state: string) {
      return ok({ state, blocked: true as const });
    },
    async exchangeCallback() {
      return err(appError("PROVIDER_UNAVAILABLE", "Live Meta connection is not configured."));
    },
    async testConnection() {
      return options.expired
        ? err(appError("PROVIDER_UNAVAILABLE", "Provider authorization expired."))
        : ok({ healthy: true });
    }
  });
}
export const sandboxMetaFixtures: Readonly<Record<string, NormalizedMetaEvent>> = Object.freeze({
  whatsappText: {
    providerEventId: "wa-msg-text-001",
    providerAccountId: "wa-phone-sandbox",
    channel: "whatsapp",
    type: "message",
    senderRef: "synthetic-wa-contact",
    text: "Synthetic WhatsApp text",
    attachments: [],
    occurredAt: "2026-01-01T00:00:00.000Z"
  },
  whatsappImage: {
    providerEventId: "wa-msg-image-001",
    providerAccountId: "wa-phone-sandbox",
    channel: "whatsapp",
    type: "message",
    senderRef: "synthetic-wa-contact",
    attachments: [
      {
        providerMediaId: "wa-media-001",
        kind: "image",
        mimeType: "image/png",
        filename: "synthetic.png",
        downloadState: "pending"
      }
    ],
    occurredAt: "2026-01-01T00:01:00.000Z"
  },
  whatsappDelivered: {
    providerEventId: "wa-status-delivered-001",
    providerAccountId: "wa-phone-sandbox",
    channel: "whatsapp",
    type: "message_status",
    providerMessageRef: "wa-out-001",
    attachments: [],
    status: "delivered",
    occurredAt: "2026-01-01T00:02:00.000Z"
  },
  whatsappRead: {
    providerEventId: "wa-status-read-001",
    providerAccountId: "wa-phone-sandbox",
    channel: "whatsapp",
    type: "message_status",
    providerMessageRef: "wa-out-001",
    attachments: [],
    status: "read",
    occurredAt: "2026-01-01T00:03:00.000Z"
  },
  whatsappFailed: {
    providerEventId: "wa-status-failed-001",
    providerAccountId: "wa-phone-sandbox",
    channel: "whatsapp",
    type: "message_status",
    providerMessageRef: "wa-out-001",
    attachments: [],
    status: "failed",
    occurredAt: "2026-01-01T00:04:00.000Z"
  },
  instagramDm: {
    providerEventId: "ig-dm-001",
    providerAccountId: "ig-account-sandbox",
    channel: "instagram",
    type: "message",
    senderRef: "synthetic-ig-contact",
    text: "Synthetic Instagram DM",
    attachments: [],
    occurredAt: "2026-01-01T00:05:00.000Z"
  },
  instagramImage: {
    providerEventId: "ig-dm-image-001",
    providerAccountId: "ig-account-sandbox",
    channel: "instagram",
    type: "message",
    senderRef: "synthetic-ig-contact",
    attachments: [{ providerMediaId: "ig-media-001", kind: "image", downloadState: "pending" }],
    occurredAt: "2026-01-01T00:06:00.000Z"
  },
  instagramComment: {
    providerEventId: "ig-comment-001",
    providerAccountId: "ig-account-sandbox",
    channel: "instagram",
    type: "comment",
    senderRef: "synthetic-ig-contact",
    text: "Synthetic post comment",
    attachments: [],
    occurredAt: "2026-01-01T00:07:00.000Z"
  },
  instagramReelComment: {
    providerEventId: "ig-reel-comment-001",
    providerAccountId: "ig-account-sandbox",
    channel: "instagram",
    type: "comment",
    senderRef: "synthetic-ig-contact",
    text: "Synthetic reel comment",
    attachments: [],
    occurredAt: "2026-01-01T00:07:30.000Z"
  },
  instagramPrivateReply: {
    providerEventId: "ig-private-reply-001",
    providerAccountId: "ig-account-sandbox",
    channel: "instagram",
    type: "private_reply",
    senderRef: "synthetic-ig-contact",
    text: "Synthetic private reply",
    attachments: [],
    occurredAt: "2026-01-01T00:08:00.000Z"
  }
});
