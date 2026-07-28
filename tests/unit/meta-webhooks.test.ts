import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { normalizeMetaWebhook } from "@/src/modules/integrations/meta/normalizer";
import {
  createSandboxMetaConnectionAdapter,
  sandboxMetaFixtures
} from "@/src/modules/integrations/meta/sandbox-adapter";
import {
  ingestVerifiedMetaPayload,
  type MetaWebhookRepository
} from "@/src/modules/integrations/meta/webhook-ingestion";
import {
  verifyMetaChallenge,
  verifyMetaSignature
} from "@/src/modules/integrations/meta/webhook-security";
const whatsAppPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "waba-synthetic",
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "wa-phone-sandbox" },
            messages: [
              {
                id: "wamid.synthetic.001",
                from: "synthetic-sender",
                timestamp: "1767225600",
                type: "image",
                image: { id: "media-synthetic", mime_type: "image/png", filename: "fixture.png" }
              }
            ]
          }
        }
      ]
    }
  ]
};
const instagramPayload = {
  object: "instagram",
  entry: [
    {
      id: "ig-account-sandbox",
      messaging: [
        {
          sender: { id: "synthetic-sender" },
          recipient: { id: "ig-account-sandbox" },
          message: { mid: "ig-mid-001", text: "Synthetic DM" }
        }
      ]
    }
  ]
};
describe("Meta webhook security and sandbox contracts", () => {
  it("verifies challenge and exact raw-body signatures", () => {
    const secret = "synthetic-meta-secret-value",
      raw = new TextEncoder().encode(JSON.stringify(whatsAppPayload));
    const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    expect(verifyMetaSignature(raw, signature, secret)).toBe(true);
    expect(verifyMetaSignature(raw, null, secret)).toBe(false);
    expect(verifyMetaSignature(raw, "sha256=bad", secret)).toBe(false);
    expect(verifyMetaSignature(new TextEncoder().encode("changed"), signature, secret)).toBe(false);
    expect(
      verifyMetaChallenge(
        { mode: "subscribe", token: "synthetic-token", challenge: "123" },
        "synthetic-token"
      )
    ).toBe("123");
    expect(
      verifyMetaChallenge(
        { mode: "subscribe", token: "wrong", challenge: "123" },
        "synthetic-token"
      )
    ).toBeNull();
    expect(verifyMetaChallenge({ mode: "subscribe", token: "", challenge: "123" }, "")).toBeNull();
  });
  it("normalizes WhatsApp image and Instagram DM without trusting workspace input", () => {
    const forged = { ...whatsAppPayload, workspace_id: "forged-workspace" };
    const wa = normalizeMetaWebhook(forged),
      ig = normalizeMetaWebhook(instagramPayload);
    expect(wa.ok && wa.value).toMatchObject({
      channel: "whatsapp",
      providerAccountId: "wa-phone-sandbox",
      providerEventId: "wamid.synthetic.001",
      senderRef: "synthetic-sender"
    });
    expect(wa.ok && wa.value.attachments[0]).toMatchObject({
      providerMediaId: "media-synthetic",
      downloadState: "pending"
    });
    expect(ig.ok && ig.value).toMatchObject({
      channel: "instagram",
      providerAccountId: "ig-account-sandbox",
      providerEventId: "ig-mid-001",
      text: "Synthetic DM"
    });
    expect(JSON.stringify(wa)).not.toContain("forged-workspace");
  });
  it("ACKs valid events quickly and emits once across webhook retries", async () => {
    const seen = new Set<string>();
    const repository: MetaWebhookRepository = {
      async ingest(event) {
        if (seen.has(event.providerEventId)) return { result: "duplicate" };
        seen.add(event.providerEventId);
        return {
          result: "accepted",
          webhookEventId: "event-1",
          trustedWorkspaceId: "trusted-workspace"
        };
      }
    };
    const started = performance.now();
    const first = await ingestVerifiedMetaPayload(whatsAppPayload, repository),
      retry = await ingestVerifiedMetaPayload(whatsAppPayload, repository);
    expect(performance.now() - started).toBeLessThan(100);
    expect(first).toMatchObject({
      acknowledged: true,
      status: "accepted",
      trustedWorkspaceId: "trusted-workspace"
    });
    expect(retry).toMatchObject({ acknowledged: true, status: "duplicate" });
    expect(seen.size).toBe(1);
  });
  it("covers all deterministic provider fixtures and safe token expiry", async () => {
    expect(Object.keys(sandboxMetaFixtures)).toEqual([
      "whatsappText",
      "whatsappImage",
      "whatsappDelivered",
      "whatsappRead",
      "whatsappFailed",
      "instagramDm",
      "instagramImage",
      "instagramComment",
      "instagramReelComment",
      "instagramPrivateReply"
    ]);
    const active = createSandboxMetaConnectionAdapter("whatsapp"),
      expired = createSandboxMetaConnectionAdapter("instagram", { expired: true });
    expect((await active.testConnection()).ok).toBe(true);
    const failure = await expired.testConnection();
    expect(failure.ok).toBe(false);
    if (!failure.ok) expect(failure.error.message).not.toMatch(/token|secret|key/i);
  });
  it("does not log message or media payloads on rejection", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await ingestVerifiedMetaPayload(
      { bad: "private-message-secret" },
      {
        async ingest() {
          throw new Error("must not run");
        }
      }
    );
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
