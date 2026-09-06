import { describe, expect, it, vi } from "vitest";

import { parseServerEnvironment } from "@/src/lib/env";
import { exchangeAndVerifyMetaCredential } from "@/src/modules/integrations/meta/live-connection-adapter";

const environment = parseServerEnvironment({
  META_CONNECTION_MODE: "live",
  META_APP_ID: "1000000000000001",
  META_APP_SECRET: "synthetic-app-secret",
  META_OAUTH_REDIRECT_URL: "https://crm.example.test/api/connections/meta/callback",
  META_GRAPH_API_VERSION: "v99.0",
  META_WHATSAPP_CONFIG_ID: "2000000000000002"
});

describe("live Meta connection adapter", () => {
  it("exchanges and verifies Instagram credentials without leaking SDK shapes", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "synthetic-access-token-123456",
            user_id: "178900000000001"
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "178900000000001", username: "synthetic_business" }), {
          status: 200
        })
      );
    const credential = await exchangeAndVerifyMetaCredential(
      {
        channel: "instagram",
        code: "synthetic_authorization_code_123"
      },
      environment,
      fetcher
    );
    expect(credential).toMatchObject({
      providerAccountId: "178900000000001",
      displayName: "synthetic_business",
      instagramAccountId: "178900000000001"
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://api.instagram.com/oauth/access_token");
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("https://graph.instagram.com/v99.0/me");
    expect(fetcher.mock.calls[1]?.[1]?.headers).toEqual({
      authorization: "Bearer synthetic-access-token-123456"
    });
  });

  it("proves the requested WhatsApp phone belongs to the returned WABA", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "synthetic-access-token-123456" }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "155500000000001",
                display_phone_number: "+1 555 000 0001"
              }
            ]
          }),
          { status: 200 }
        )
      );
    const credential = await exchangeAndVerifyMetaCredential(
      {
        channel: "whatsapp",
        code: "synthetic_authorization_code_456",
        wabaId: "155500000000000",
        phoneNumberId: "155500000000001"
      },
      environment,
      fetcher
    );
    expect(credential).toMatchObject({
      providerAccountId: "155500000000001",
      wabaId: "155500000000000",
      phoneNumberId: "155500000000001"
    });
  });

  it("fails safely on asset mismatch and provider errors", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "synthetic-access-token-123456" }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await expect(
      exchangeAndVerifyMetaCredential(
        {
          channel: "whatsapp",
          code: "synthetic_authorization_code_789",
          wabaId: "155500000000000",
          phoneNumberId: "155500000000001"
        },
        environment,
        fetcher
      )
    ).rejects.toThrow("META_WHATSAPP_ASSET_MISMATCH");
  });
});
