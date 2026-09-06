import { appError, err, ok, type Result } from "@/src/lib/result";
import type { AttachmentMetadata, MetaChannel, NormalizedMetaEvent } from "./contracts";

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
const first = (value: unknown): JsonObject => (Array.isArray(value) ? object(value[0]) : {});
const list = (value: unknown): JsonObject[] =>
  Array.isArray(value) ? value.map(object).filter((entry) => Object.keys(entry).length > 0) : [];
const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/**
 * One inbound item, paired with the envelope it arrived in.
 *
 * Meta batches: a single POST carries many `entry[]`, each carrying many
 * `changes[]`, each carrying many `messages[]` or `statuses[]`. Identity and
 * routing come from the envelope, so each item has to keep a reference to it.
 */
type Candidate = Readonly<{
  entry: JsonObject;
  change: JsonObject;
  value: JsonObject;
  source: JsonObject;
  kind: "message" | "status" | "comment";
}>;

/**
 * Enumerates every event in a delivery.
 *
 * Previously this read `entry[0].changes[0]` and one message within it, so
 * everything after the first item in a batched delivery was discarded — no
 * error, no log, the customer's message simply never arrived. Meta batches
 * routinely under load, which is exactly when losing messages matters most.
 */
function candidates(root: JsonObject): Candidate[] {
  const found: Candidate[] = [];
  for (const entry of list(root.entry)) {
    for (const change of list(entry.changes)) {
      const value = object(change.value);
      for (const source of list(value.messages)) {
        found.push({ entry, change, value, source, kind: "message" });
      }
      for (const source of list(value.statuses)) {
        found.push({ entry, change, value, source, kind: "status" });
      }
      for (const source of list(value.comments)) {
        found.push({ entry, change, value, source, kind: "comment" });
      }
      // A comment change can carry its payload directly on `value` rather than
      // in a `comments[]` array.
      if (
        !list(value.messages).length &&
        !list(value.statuses).length &&
        !list(value.comments).length
      ) {
        if (change.field === "comments") {
          found.push({ entry, change, value, source: value, kind: "comment" });
        } else if (Object.keys(object(value.message)).length) {
          found.push({
            entry,
            change,
            value,
            source: object(value.message),
            kind: "message"
          });
        }
      }
    }
    // Instagram and Messenger deliver through `messaging[]` instead of
    // `changes[]`, one item per event.
    for (const messaging of list(entry.messaging)) {
      const source = Object.keys(object(messaging.message)).length
        ? object(messaging.message)
        : messaging;
      found.push({ entry, change: {}, value: messaging, source, kind: "message" });
    }
  }
  return found;
}

function normalizeCandidate(
  root: JsonObject,
  candidate: Candidate
): NormalizedMetaEvent | undefined {
  const { entry, value, source, kind } = candidate;
  const channel: MetaChannel =
    root.object === "whatsapp_business_account" ? "whatsapp" : "instagram";
  const metadata = object(value.metadata);
  const recipient = object(value.recipient);
  const providerAccountId =
    channel === "whatsapp"
      ? text(metadata.phone_number_id) || text(entry.id)
      : text(entry.id) || text(recipient.id);
  const providerEventId = text(source.id) || text(source.mid) || text(source.message_id);
  // An item without both identifiers cannot be routed or deduplicated, so it is
  // skipped rather than allowed to poison the rest of the batch.
  if (!providerAccountId || !providerEventId) return undefined;

  const rawTimestamp = source.timestamp;
  const timestamp = rawTimestamp
    ? new Date(Number(rawTimestamp) * 1000)
    : new Date(text(source.created_time) || 0);
  const occurredAt =
    Number.isNaN(timestamp.valueOf()) || timestamp.valueOf() === 0
      ? new Date(0).toISOString()
      : timestamp.toISOString();

  const messageValue = kind === "message" ? source : {};
  const status = kind === "status" ? source : {};
  const comment = kind === "comment" ? source : {};

  const image = object(messageValue.image);
  const video = object(messageValue.video);
  const audio = object(messageValue.audio);
  const document = object(messageValue.document);
  const attachment = first(messageValue.attachments);
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
    const mediaKind: AttachmentMetadata["kind"] = Object.keys(image).length
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
      // Provider URLs are untrusted, short-lived inputs and must never become a
      // download target. A server adapter must resolve this opaque provider ID.
      providerMediaId: text(media.id) || "unresolved",
      kind: mediaKind,
      ...(text(media.mime_type) ? { mimeType: text(media.mime_type) } : {}),
      ...(text(media.filename) ? { filename: text(media.filename) } : {}),
      downloadState: "pending"
    });
  }

  const statusValue = text(status.status);
  const messageText = object(messageValue.text);
  const body = text(messageText.body) || text(messageValue.text) || text(comment.text);
  const sender = object(value.sender);
  const type =
    kind === "status"
      ? "message_status"
      : kind === "comment"
        ? "comment"
        : messageValue.is_private_reply === true
          ? "private_reply"
          : "message";

  return {
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
  };
}

/**
 * Normalizes an entire delivery.
 *
 * Returns every event the payload contains, in arrival order, deduplicated by
 * provider event id so a provider that repeats an item within one batch cannot
 * produce two rows.
 */
export function normalizeMetaWebhook(payload: unknown): Result<readonly NormalizedMetaEvent[]> {
  const root = object(payload);
  if (!Object.keys(root).length) return err(appError("VALIDATION_ERROR", "Malformed webhook."));

  const seen = new Set<string>();
  const events: NormalizedMetaEvent[] = [];
  for (const candidate of candidates(root)) {
    const event = normalizeCandidate(root, candidate);
    if (!event) continue;
    const key = `${event.channel}:${event.providerEventId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(event);
  }

  if (!events.length) return err(appError("VALIDATION_ERROR", "Webhook identifiers are missing."));
  return ok(events);
}
