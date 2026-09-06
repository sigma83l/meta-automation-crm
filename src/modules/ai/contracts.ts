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

/**
 * The cheap first pass: what the customer wants, in what language, and whether
 * this turn carries enough at stake to justify the expensive model.
 *
 * Separate from the reply because the router treats them as separate roles.
 * Classification is `utility` work and runs before retrieval; the reply is
 * `primary` or `escalation` work and cannot be written until retrieval has
 * said what is actually approved. Producing both in one call would mean
 * drafting a reply before knowing the facts it must be built from.
 */
export const turnClassificationSchema = z
  .object({
    intent: z.string().trim().min(1).max(100),
    language: z.string().trim().min(2).max(16),
    confidence: z.number().min(0).max(1),
    /** A high-value objection or genuine ambiguity. Feeds RoutingSignals. */
    highStakes: z.boolean()
  })
  .strict();
export type TurnClassification = z.infer<typeof turnClassificationSchema>;

export type AiReplyInput = Readonly<{
  workspaceId: string;
  conversationId: string;
  messages: readonly Readonly<{ role: "customer" | "business"; content: string }>[];
  requiredFields: readonly string[];
  /**
   * What the CRM already knows about this contact.
   *
   * The workspace's own record, not the customer's words, so it sits outside
   * the untrusted fence with the approved knowledge. Its purpose is narrow: a
   * returning customer must not be asked again for something they already
   * answered. Facts past their validity window are dropped before they get
   * here - stale is not knowledge, and a model told an old budget is current
   * will quote against it.
   */
  knownFacts: readonly Readonly<{ key: string; value: string; confidence: string }>[];
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
  /** The utility-role first pass. Cheap, and run before retrieval. */
  classifyTurn(input: AiReplyInput): Promise<Result<TurnClassification>>;
  generateStructuredReply(input: AiReplyInput): Promise<Result<StructuredReply>>;
  testConnection(): Promise<Result<{ available: boolean }>>;
  classifyProviderError(error: unknown): ClassifiedProviderError;
  getUsageMetadata(): ProviderUsage | null;
}
