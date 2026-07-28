import { appError, err, ok, type Result } from "@/src/lib/result";
import type { AttachmentMetadata, MetaChannel, NormalizedMetaEvent } from "./contracts";

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
const first = (value: unknown): JsonObject => (Array.isArray(value) ? object(value[0]) : {});
const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

export function normalizeMetaWebhook(payload: unknown): Result<NormalizedMetaEvent> {
  const root = object(payload);
  if (!Object.keys(root).length) return err(appError("VALIDATION_ERROR", "Malformed webhook."));
  const entry = first(root.entry),
    change = first(entry.changes),
    changeValue = object(change.value),
    messaging = first(entry.messaging);
  const value = Object.keys(changeValue).length ? changeValue : messaging;
  const channel: MetaChannel =
    root.object === "whatsapp_business_account" ? "whatsapp" : "instagram";
  const metadata = object(value.metadata),
    recipient = object(value.recipient);
  const providerAccountId =
    channel === "whatsapp"
      ? text(metadata.phone_number_id) || text(entry.id)
      : text(entry.id) || text(recipient.id);
  const message = first(value.messages);
  const messageValue = Object.keys(message).length ? message : object(value.message);
  const status = first(value.statuses);
  const comments = first(value.comments);
  const comment = Object.keys(comments).length
    ? comments
    : change.field === "comments"
      ? changeValue
      : {};
  const source = Object.keys(messageValue).length
    ? messageValue
    : Object.keys(status).length
      ? status
      : comment;
  const providerEventId = text(source.id) || text(source.mid) || text(source.message_id);
  if (!providerAccountId || !providerEventId)
    return err(appError("VALIDATION_ERROR", "Webhook identifiers are missing."));
  const rawTimestamp = source.timestamp;
  const timestamp = rawTimestamp
    ? new Date(Number(rawTimestamp) * 1000)
    : new Date(text(source.created_time) || 0);
  const occurredAt =
    Number.isNaN(timestamp.valueOf()) || timestamp.valueOf() === 0
      ? new Date(0).toISOString()
      : timestamp.toISOString();
  const image = object(messageValue.image),
    video = object(messageValue.video),
    audio = object(messageValue.audio),
    document = object(messageValue.document);
  const attachment = first(object(messageValue.attachments).data);
  const media = Object.keys(image).length
    ? image
    : Object.keys(video).length
      ? video
      : Object.keys(audio).length
        ? audio
        : Object.keys(document).length
          ? document
          : attachment;
  const attachments: AttachmentMetadata[] = [];
  if (Object.keys(media).length) {
    const payloadData = object(media.payload);
    const kind: AttachmentMetadata["kind"] = Object.keys(image).length
      ? "image"
      : Object.keys(video).length
        ? "video"
        : Object.keys(audio).length
          ? "audio"
          : Object.keys(document).length
            ? "document"
            : media.type === "image"
              ? "image"
              : "document";
    attachments.push({
      providerMediaId: text(media.id) || text(payloadData.url) || "unknown",
      kind,
      ...(text(media.mime_type) ? { mimeType: text(media.mime_type) } : {}),
      ...(text(media.filename) ? { filename: text(media.filename) } : {}),
      downloadState: "pending"
    });
  }
  const statusValue = text(status.status);
  const messageText = object(messageValue.text);
  const body = text(messageText.body) || text(messageValue.text) || text(comment.text);
  const sender = object(value.sender);
  const type = Object.keys(status).length
    ? "message_status"
    : Object.keys(comment).length
      ? "comment"
      : messageValue.is_private_reply === true
        ? "private_reply"
        : "message";
  return ok({
    providerEventId,
    providerAccountId,
    channel,
    type,
    ...(text(messageValue.from) || text(sender.id)
      ? { senderRef: text(messageValue.from) || text(sender.id) }
      : {}),
    ...(text(status.id) ? { providerMessageRef: text(status.id) } : {}),
    ...(body ? { text: body } : {}),
    attachments,
    ...(statusValue ? { status: statusValue as "delivered" | "read" | "failed" } : {}),
    occurredAt
  });
}
