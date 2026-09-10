import { describe, expect, it } from "vitest";
import { createDeterministicAiProvider } from "@/src/modules/ai/providers/deterministic-provider";
import { authorizeOutboundSend } from "@/src/modules/integrations/live-send-gate";
import { createFakeMessagingProvider } from "@/src/modules/integrations/providers/fake-messaging-provider";
import { syntheticInboundFixture, syntheticWorkspace } from "@/tests/fixtures/synthetic";
import { TEST_BUSINESS } from "@/tests/fixtures/business-voice";

const sandboxAuthorization = Object.freeze({
  mode: "sandbox" as const,
  environmentEnabled: false,
  explicitApproval: false,
  recipientAllowlisted: false
});

describe("provider seams", () => {
  it.each(["whatsapp", "instagram"] as const)("normalizes deterministic %s fixtures", (channel) => {
    const provider = createFakeMessagingProvider(channel);
    const result = provider.normalizeInbound(syntheticInboundFixture);

    expect(result).toEqual({
      ok: true,
      value: {
        ...syntheticInboundFixture,
        channel,
        synthetic: true
      }
    });
  });

  it("allows sandbox sends and produces deterministic receipts", async () => {
    const provider = createFakeMessagingProvider("whatsapp");
    const result = await provider.send({
      workspaceId: syntheticWorkspace.id,
      recipientRef: "synthetic-contact-001",
      text: "Synthetic response",
      idempotencyKey: "send-fixture-001",
      authorization: sandboxAuthorization
    });

    expect(result).toEqual({
      ok: true,
      value: {
        providerMessageId: "fake-whatsapp-send-fixture-001",
        channel: "whatsapp",
        idempotencyKey: "send-fixture-001",
        synthetic: true
      }
    });
  });

  it("fails live sends closed unless every gate is satisfied", () => {
    const result = authorizeOutboundSend({
      mode: "live",
      environmentEnabled: false,
      explicitApproval: false,
      recipientAllowlisted: false
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LIVE_SEND_BLOCKED");
      expect(result.error.details?.missing).toContain("environment gate");
      expect(result.error.details?.missing).toContain("explicit approval");
      expect(result.error.details?.missing).toContain("recipient allowlist");
    }
  });

  it("has no real provider implementation even after live authorization", async () => {
    const provider = createFakeMessagingProvider("instagram");
    const result = await provider.send({
      workspaceId: syntheticWorkspace.id,
      recipientRef: "allowlisted-synthetic-contact",
      text: "This must not leave the sandbox adapter.",
      idempotencyKey: "send-fixture-002",
      authorization: {
        mode: "live",
        environmentEnabled: true,
        explicitApproval: true,
        recipientAllowlisted: true
      }
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PROVIDER_UNAVAILABLE");
    }
  });

  it("requires human review when fake AI has no approved knowledge", async () => {
    const provider = createDeterministicAiProvider();
    const result = await provider.generateStructuredReply({
      workspaceId: syntheticWorkspace.id,
      conversationId: "conv-synthetic-001",
      messages: [{ role: "customer", content: "What is the price?" }],
      requiredFields: [],
      knownFacts: [],
      faqItems: [],
      priceItems: [],
      policy: {
        primaryLanguage: "en",
        fallbackLanguage: "en",
        forbiddenClaims: [],
        escalationKeywords: [],
        lowConfidenceThreshold: 0.65
      },
      business: TEST_BUSINESS,
      classification: "synthetic",
      demoMode: true
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.needsHuman).toBe(true);
      expect(result.value.confidence).toBeLessThan(0.5);
      expect(result.value.knowledgeItemIds).toEqual([]);
    }
  });
});
