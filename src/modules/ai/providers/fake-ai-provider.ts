import { appError, err, ok } from "@/src/lib/result";
import type { AiProvider, AiReplyInput } from "@/src/modules/ai/providers/ai-provider";

export function createFakeAiProvider(): AiProvider {
  return Object.freeze({
    name: "deterministic-fake",
    async generateStructuredReply(input: AiReplyInput) {
      if (!input.workspaceId || !input.conversationId || !input.customerMessage.trim()) {
        return err(appError("VALIDATION_ERROR", "AI fixture is missing required context."));
      }
      const hasKnowledge = input.approvedKnowledge.length > 0;
      return ok(
        Object.freeze({
          intent: "product_question",
          language: input.language,
          reply: hasKnowledge
            ? `Sandbox answer: ${input.approvedKnowledge[0]}`
            : "A team member needs to confirm this answer.",
          confidence: hasKnowledge ? 0.96 : 0.3,
          needsHuman: !hasKnowledge,
          synthetic: true
        })
      );
    },
    async testConnection() {
      return ok(Object.freeze({ available: true, synthetic: true }));
    }
  });
}
