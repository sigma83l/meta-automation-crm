import { z } from "zod";
import { aiModes } from "@/src/modules/ai/contracts";

export const businessProfileInputSchema = z.object({
  brandName: z.string().trim().min(1).max(120),
  description: z.string().trim().max(4000),
  primaryLanguage: z.string().trim().min(2).max(16),
  fallbackLanguage: z.string().trim().min(2).max(16),
  tone: z.enum(["friendly", "formal"]),
  answerLength: z.enum(["short", "medium"]),
  emojiPolicy: z.enum(["allowed", "limited", "off"]),
  businessHours: z.record(z.string(), z.string().max(100)),
  timezone: z.string().trim().min(1).max(80),
  forbiddenClaims: z.array(z.string().trim().min(1).max(300)).max(100),
  escalationKeywords: z.array(z.string().trim().min(1).max(100)).max(100),
  lowConfidenceThreshold: z.number().min(0).max(1),
  retentionDays: z.number().int().min(1).max(3650),
  aiMode: z.enum(aiModes),
  demoModeEnabled: z.boolean()
});
export type BusinessProfileInput = z.infer<typeof businessProfileInputSchema>;

export type BusinessProfile = BusinessProfileInput & Readonly<{ workspaceId: string }>;
export type FaqItem = Readonly<{
  id: string;
  question: string;
  answer: string;
  language: string;
  enabled: boolean;
}>;
export type PriceItem = Readonly<{
  id: string;
  name: string;
  description: string;
  amountMinor: number;
  currency: string;
  availability: "available" | "unavailable" | "ask_human";
  enabled: boolean;
}>;
export type CredentialStatus = Readonly<{
  provider: "gemini" | "openai" | "anthropic";
  status: string;
  maskedSuffix: string;
  keyVersion: number;
}>;
