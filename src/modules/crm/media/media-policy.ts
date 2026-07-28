import { createHash, randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";

const allowed = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"]
]);

export type ValidatedMedia = Readonly<{
  bytes: Uint8Array;
  mimeType: string;
  byteSize: number;
  sha256: string;
  originalName: string;
  safeName: string;
}>;

export async function validateMedia(
  bytes: Uint8Array,
  originalName: string,
  maximumBytes: number
): Promise<ValidatedMedia> {
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    throw new Error("MEDIA_SIZE_REJECTED");
  }
  const detected = await fileTypeFromBuffer(bytes);
  if (!detected || !allowed.has(detected.mime)) throw new Error("MEDIA_TYPE_REJECTED");
  const base = sanitizeFilename(originalName.replace(/\.[^.]*$/, ""));
  const safeName = `${base || "file"}-${randomUUID().slice(0, 12)}.${allowed.get(detected.mime)}`;
  return {
    bytes,
    mimeType: detected.mime,
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    originalName: originalName.slice(0, 255),
    safeName
  };
}

export function sanitizeFilename(value: string) {
  const basename = value.replaceAll("\\", "/").split("/").at(-1) ?? "";
  return basename
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^[._-]+/, "")
    .replace(/-+/g, "-")
    .slice(0, 100);
}

export function safeArchivePath(customerId: string, filename: string) {
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) throw new Error("INVALID_CUSTOMER_PATH");
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    throw new Error("ZIP_PATH_REJECTED");
  }
  const safe = sanitizeFilename(filename);
  if (!safe) throw new Error("ZIP_PATH_REJECTED");
  return `attachments/${customerId}/${safe}`;
}
