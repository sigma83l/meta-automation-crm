import { describe, expect, it, vi } from "vitest";

import {
  isAllowedMetaMediaUrl,
  LiveMetaMediaDownloader
} from "@/src/modules/integrations/meta/live-media-adapter";
import { fetchWhatsappTemplateInventory } from "@/src/modules/integrations/meta/template-inventory-adapter";

const connectionId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";

describe("Meta production-shaped provider adapters", () => {
  it("allows only fixed Meta media hosts over HTTPS", () => {
    expect(isAllowedMetaMediaUrl(new URL("https://lookaside.fbsbx.com/file"))).toBe(true);
    expect(isAllowedMetaMediaUrl(new URL("https://edge.fbcdn.net/file"))).toBe(true);
    expect(isAllowedMetaMediaUrl(new URL("http://lookaside.fbsbx.com/file"))).toBe(false);
    expect(isAllowedMetaMediaUrl(new URL("https://fbcdn.net.attacker.example/file"))).toBe(false);
  });

  it("rejects an untrusted media redirect before downloading bytes", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ url: "https://attacker.example/private" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    );
    const adapter = new LiveMetaMediaDownloader(
      "v24.0",
      async () => "masked-test-access-token",
      fetcher as typeof fetch
    );
    const result = await adapter.download({
      connectionId,
      workspaceId,
      providerMediaId: "1234567890"
    });
    expect(result.ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("bounds media bytes and verifies the response MIME type", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/file" }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
          status: 200,
          headers: { "content-type": "image/jpeg", "content-length": "3" }
        })
      );
    const adapter = new LiveMetaMediaDownloader(
      "v24.0",
      async () => "masked-test-access-token",
      fetcher as typeof fetch
    );
    const result = await adapter.download({
      connectionId,
      workspaceId,
      providerMediaId: "1234567890"
    });
    expect(result).toMatchObject({ ok: true, value: { mimeType: "image/jpeg" } });
  });

  it("normalizes the approved WhatsApp template inventory", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "88", name: "appointment_reminder", language: "en_US", status: "APPROVED" }
            ]
          }),
          { status: 200 }
        )
    );
    await expect(
      fetchWhatsappTemplateInventory(
        { graphVersion: "v24.0", wabaId: "123456", accessToken: "masked-test-access-token" },
        fetcher as typeof fetch
      )
    ).resolves.toEqual([
      { id: "88", name: "appointment_reminder", language: "en_US", status: "APPROVED" }
    ]);
  });
});
