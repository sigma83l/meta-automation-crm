import { z } from "zod";
import { FACT_CONFIDENCES } from "@/src/modules/rcos/memory-policy";

/** A knowledge item typed into the lab rather than stored in the workspace. */
const draftFaqSchema = z
  .object({
    question: z.string().trim().min(1).max(500),
    answer: z.string().trim().min(1).max(2000)
  })
  .strict();

const draftPriceSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    amountMinor: z.number().int().min(0).max(100_000_000),
    currency: z.string().trim().min(3).max(3),
    availability: z.enum(["available", "unavailable", "ask_human"])
  })
  .strict();

const draftFactSchema = z
  .object({
    key: z.string().trim().min(1).max(100),
    value: z.string().trim().min(1).max(1000),
    // The engine's own vocabulary, not a second one. `FACT_CONFIDENCES` is
    // ordered weakest to strongest and that order is what decides whether a
    // remembered fact may be overwritten - a lab that invented its own labels
    // would produce facts the memory policy cannot rank.
    confidence: z.enum(FACT_CONFIDENCES)
  })
  .strict();

const policySchema = z
  .object({
    primaryLanguage: z.string().trim().min(2).max(16),
    fallbackLanguage: z.string().trim().min(2).max(16),
    forbiddenClaims: z.array(z.string().trim().min(1).max(300)).max(50),
    escalationKeywords: z.array(z.string().trim().min(1).max(100)).max(50),
    lowConfidenceThreshold: z.number().min(0).max(1)
  })
  .strict();

export const labRunSchema = z
  .object({
    /**
     * `prompt` calls the model directly and shows what it said. `pipeline`
     * runs the real turn engine, which is the only mode that can tell you
     * whether the reply would have been allowed out.
     */
    mode: z.enum(["prompt", "pipeline"]),
    message: z.string().trim().min(1).max(4000),
    /** Prior turns. Pipeline mode reads the real conversation instead. */
    history: z
      .array(
        z
          .object({
            role: z.enum(["customer", "business"]),
            content: z.string().trim().min(1).max(4000)
          })
          .strict()
      )
      .max(20)
      .default([]),
    models: z
      .object({
        utility: z.string().trim().max(100).optional(),
        primary: z.string().trim().max(100).optional(),
        escalation: z.string().trim().max(100).optional()
      })
      .strict()
      .default({}),
    systemPrompt: z.string().trim().max(20_000).optional(),
    policy: policySchema.optional(),
    /** Replaces the workspace's approved knowledge for this run when present. */
    faqItems: z.array(draftFaqSchema).max(50).optional(),
    priceItems: z.array(draftPriceSchema).max(50).optional(),
    knownFacts: z.array(draftFactSchema).max(50).optional(),
    /** Pipeline mode: start a new synthetic conversation instead of continuing. */
    freshConversation: z.boolean().default(false)
  })
  .strict();

export type LabRunRequest = z.infer<typeof labRunSchema>;
