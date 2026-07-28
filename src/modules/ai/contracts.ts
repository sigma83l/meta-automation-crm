import { z } from "zod";
import type { Result } from "@/src/lib/result";

export const aiModes = [
  "PLATFORM_PAID_DEFAULT",
  "WORKSPACE_BYOK_GEMINI",
  "WORKSPACE_BYOK_OPENAI",
  "WORKSPACE_BYOK_ANTHROPIC",
  "FREE_GEMINI_DEMO_SYNTHETIC_ONLY"
] as const;
export type AiMode = (typeof aiModes)[number];
export type AiProviderName = "platform" | "gemini" | "openai" | "anthropic";
export type DataClassification = "synthetic" | "webhook" | "crm" | "customer_media";

export const structuredReplySchema = z
  .object({
    intent: z.string().trim().min(1).max(100),
    language: z.string().trim().min(2).max(16),
    extractedFields: z.record(z.string(), z.string().max(1000)),
    missingRequiredFields: z.array(z.string().min(1).max(100)).max(50),
    reply: z.string().trim().min(1).max(4000),
    knowledgeItemIds: z.array(z.uuid()).max(50),
    confidence: z.number().min(0).max(1),
    needsHuman: z.boolean(),
    reason: z.string().trim().min(1).max(500)
  })
  .strict();
export type StructuredReply = z.infer<typeof structuredReplySchema>;

export type AiReplyInput = Readonly<{
  workspaceId: string;
  conversationId: string;
  messages: readonly Readonly<{ role: "customer" | "business"; content: string }>[];
  requiredFields: readonly string[];
  faqItems: readonly Readonly<{ id: string; question: string; answer: string }>[];
  priceItems: readonly Readonly<{
    id: string;
    name: string;
    amountMinor: number;
    currency: string;
    availability: "available" | "unavailable" | "ask_human";
  }>[];
  policy: Readonly<{
    primaryLanguage: string;
    fallbackLanguage: string;
    forbiddenClaims: readonly string[];
    escalationKeywords: readonly string[];
    lowConfidenceThreshold: number;
  }>;
  classification: DataClassification;
  demoMode: boolean;
}>;
export type ProviderUsage = Readonly<{ inputTokens: number; outputTokens: number; model: string }>;
export type ClassifiedProviderError = Readonly<{
  kind: "timeout" | "rate_limit" | "authentication" | "invalid_output" | "unavailable";
  retryable: boolean;
}>;

export interface AiProvider {
  readonly name: AiProviderName | "deterministic-mock";
  generateStructuredReply(input: AiReplyInput): Promise<Result<StructuredReply>>;
  testConnection(): Promise<Result<{ available: boolean }>>;
  classifyProviderError(error: unknown): ClassifiedProviderError;
  getUsageMetadata(): ProviderUsage | null;
}
