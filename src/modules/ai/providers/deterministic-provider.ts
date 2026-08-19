import { appError, err, ok } from "@/src/lib/result";
import type { AiProvider, AiReplyInput, ProviderUsage } from "../contracts";

export function createDeterministicAiProvider(
  options: { failure?: "timeout" | "rate_limit" } = {}
): AiProvider {
  let usage: ProviderUsage | null = null;
  return Object.freeze({
    name: "deterministic-mock" as const,
    async classifyTurn(input: AiReplyInput) {
      if (options.failure)
        return err(
          appError("PROVIDER_UNAVAILABLE", "AI provider is temporarily unavailable.", {
            retryable: true,
            details: { kind: options.failure }
          })
        );
      const last = input.messages.at(-1)?.content.toLowerCase() ?? "";
      return ok({
        intent: "business_question",
        language: input.policy.primaryLanguage,
        confidence: 0.8,
        highStakes: input.policy.escalationKeywords.some((keyword) =>
          last.includes(keyword.toLowerCase())
        )
      });
    },
    async generateStructuredReply(input: AiReplyInput) {
      if (options.failure)
        return err(
          appError("PROVIDER_UNAVAILABLE", "AI provider is temporarily unavailable.", {
            retryable: true,
            details: { kind: options.failure }
          })
        );
      const knowledge = input.faqItems[0] ?? input.priceItems[0];
      usage = { inputTokens: 20, outputTokens: 12, model: "deterministic-fixture-v1" };
      return ok({
        intent: "business_question",
        language: input.policy.primaryLanguage,
        extractedFields: Object.fromEntries(
          input.requiredFields
            .filter((field) => input.messages.at(-1)?.content.includes(`${field}:`))
            .map((field) => [field, "synthetic-value"])
        ),
        missingRequiredFields: input.requiredFields.filter(
          (field) => !input.messages.at(-1)?.content.includes(`${field}:`)
        ),
        reply:
          knowledge && "answer" in knowledge
            ? knowledge.answer
            : "A team member needs to confirm this information.",
        knowledgeItemIds: knowledge ? [knowledge.id] : [],
        confidence: knowledge ? 0.94 : 0.2,
        needsHuman: !knowledge,
        reason: knowledge ? "Approved structured knowledge matched." : "No approved knowledge."
      });
    },
    async testConnection() {
      return options.failure
        ? err(appError("PROVIDER_UNAVAILABLE", "Connection test failed.", { retryable: true }))
        : ok({ available: true });
    },
    classifyProviderError(error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (/timeout/i.test(message)) return { kind: "timeout" as const, retryable: true };
      if (/rate/i.test(message)) return { kind: "rate_limit" as const, retryable: true };
      if (/auth|key/i.test(message)) return { kind: "authentication" as const, retryable: false };
      return { kind: "unavailable" as const, retryable: true };
    },
    getUsageMetadata() {
      return usage;
    }
  });
}
