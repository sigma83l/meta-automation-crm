import { appError, err, ok, type Result } from "@/src/lib/result";
import {
  structuredReplySchema,
  type AiMode,
  type AiReplyInput,
  type StructuredReply
} from "./contracts";

export function assertAiModePrivacy(mode: AiMode, input: AiReplyInput): Result<true> {
  if (
    mode === "FREE_GEMINI_DEMO_SYNTHETIC_ONLY" &&
    (!input.demoMode || input.classification !== "synthetic")
  ) {
    return err(
      appError(
        "AI_PRIVACY_BLOCKED",
        "Free Gemini is restricted to explicit Demo mode with synthetic data."
      )
    );
  }
  return ok(true);
}

export function enforceReplyGuardrails(
  candidate: unknown,
  input: AiReplyInput
): Result<StructuredReply> {
  const parsed = structuredReplySchema.safeParse(candidate);
  if (!parsed.success)
    return err(appError("PROVIDER_UNAVAILABLE", "AI output failed strict validation."));
  const reply = parsed.data;
  const approvedIds = new Set([
    ...input.faqItems.map((item) => item.id),
    ...input.priceItems.map((item) => item.id)
  ]);
  if (reply.knowledgeItemIds.some((id) => !approvedIds.has(id)))
    return err(appError("PROVIDER_UNAVAILABLE", "AI output cited unapproved knowledge."));
  const unavailablePrice = input.priceItems.some(
    (item) => reply.knowledgeItemIds.includes(item.id) && item.availability !== "available"
  );
  const injected = input.messages.some((message) =>
    /(ignore|override|reveal).{0,30}(system|security|rules|prompt)/i.test(message.content)
  );
  const needsHuman =
    reply.needsHuman ||
    reply.knowledgeItemIds.length === 0 ||
    unavailablePrice ||
    injected ||
    reply.confidence < input.policy.lowConfidenceThreshold ||
    reply.missingRequiredFields.length > 0;
  return ok({
    ...reply,
    needsHuman,
    reason: needsHuman && !reply.needsHuman ? "Policy requires human review." : reply.reason
  });
}

export function minimizeAiContext(input: AiReplyInput): AiReplyInput {
  return Object.freeze({
    ...input,
    messages: Object.freeze(input.messages.slice(-8)),
    requiredFields: Object.freeze(input.requiredFields.slice(0, 20)),
    knownFacts: Object.freeze(input.knownFacts.slice(0, 20)),
    faqItems: Object.freeze(input.faqItems.slice(0, 20)),
    priceItems: Object.freeze(input.priceItems.slice(0, 20))
  });
}
