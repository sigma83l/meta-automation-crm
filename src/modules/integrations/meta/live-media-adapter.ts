import { z } from "zod";

import { appError, err, ok, type Result } from "@/src/lib/result";
import type { ProviderMediaDownloader } from "@/src/modules/integrations/meta/contracts";

type Fetcher = typeof fetch;
type TokenResolver = (connectionId: string, workspaceId: string) => Promise<string>;

const metadataSchema = z.object({
  url: z.url(),
  mime_type: z.string().min(3).max(120).optional(),
  file_size: z.number().int().positive().max(10_485_760).optional()
});
const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "audio/mpeg",
  "audio/ogg",
  "application/pdf"
]);

export class LiveMetaMediaDownloader implements ProviderMediaDownloader {
  constructor(
    private readonly graphVersion: string,
    private readonly resolveToken: TokenResolver,
    private readonly fetcher: Fetcher = fetch,
    private readonly maxBytes = 10_485_760
  ) {}

  async download(input: {
    connectionId: string;
    providerMediaId: string;
    workspaceId: string;
  }): Promise<Result<{ bytes: Uint8Array; mimeType: string }>> {
    if (
      !/^v\d{1,2}\.\d{1,2}$/.test(this.graphVersion) ||
      !/^\d{5,40}$/.test(input.providerMediaId) ||
      !/^[0-9a-f-]{36}$/i.test(input.connectionId) ||
      !/^[0-9a-f-]{36}$/i.test(input.workspaceId)
    ) {
      return err(appError("VALIDATION_ERROR", "Provider media reference is invalid."));
    }

    try {
      const token = await this.resolveToken(input.connectionId, input.workspaceId);
      const metadataResponse = await this.fetcher(
        `https://graph.facebook.com/${this.graphVersion}/${input.providerMediaId}`,
        {
          headers: { authorization: `Bearer ${token}` },
          redirect: "error",
          signal: AbortSignal.timeout(10_000)
        }
      );
      if (!metadataResponse.ok) throw new Error("metadata");
      const metadata = metadataSchema.parse(await metadataResponse.json());
      const mediaUrl = new URL(metadata.url);
      if (!isAllowedMetaMediaUrl(mediaUrl)) throw new Error("host");
      if (metadata.file_size && metadata.file_size > this.maxBytes) throw new Error("size");

      const mediaResponse = await this.fetcher(mediaUrl, {
        headers: { authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(15_000)
      });
      if (!mediaResponse.ok) throw new Error("download");
      const contentLength = Number(mediaResponse.headers.get("content-length") ?? 0);
      if (contentLength > this.maxBytes) throw new Error("size");
      const mimeType = (mediaResponse.headers.get("content-type") ?? metadata.mime_type ?? "")
        .split(";")[0]!
        .trim()
        .toLowerCase();
      if (!allowedTypes.has(mimeType)) throw new Error("mime");
      const bytes = new Uint8Array(await mediaResponse.arrayBuffer());
      if (!bytes.length || bytes.byteLength > this.maxBytes) throw new Error("size");
      return ok({ bytes, mimeType });
    } catch {
      return err(
        appError("PROVIDER_UNAVAILABLE", "Provider media could not be downloaded safely.", {
          retryable: true
        })
      );
    }
  }
}

export function isAllowedMetaMediaUrl(url: URL) {
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const hostname = url.hostname.toLowerCase();
  return (
    hostname === "lookaside.fbsbx.com" ||
    hostname === "scontent.cdninstagram.com" ||
    hostname.endsWith(".fbcdn.net") ||
    hostname.endsWith(".cdninstagram.com")
  );
}
