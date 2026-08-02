import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { requireCsrf } from "@/src/modules/auth/security/route";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
import { assertWorkspaceManager } from "@/src/modules/workspaces/server/resolve-workspace";

const stages = [
  "welcome",
  "business-profile",
  "languages",
  "knowledge",
  "ai-mode",
  "channels",
  "first-recipe",
  "simulation"
] as const;

const safeValue = z.union([
  z.string().trim().max(2_000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().trim().max(200)).max(20)
]);
const requestSchema = z.object({
  stage: z.enum(stages),
  action: z.enum(["save", "complete", "skip"]),
  data: z
    .record(z.string().regex(/^[a-z][a-zA-Z0-9]{0,48}$/), safeValue)
    .refine((value) => Object.keys(value).length <= 24)
});
const forbiddenKey = /(token|secret|password|authorization|cookie|session|apiKey|privateKey)/i;

export async function PATCH(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;

  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (
      !parsed.success ||
      Object.keys(parsed.data?.data ?? {}).some((key) => forbiddenKey.test(key))
    ) {
      return NextResponse.json({ error: "INVALID_ONBOARDING_UPDATE" }, { status: 400 });
    }

    const { workspace } = await createMetaRuntime();
    assertWorkspaceManager(workspace);
    const admin = await createSupabaseAdminClient();
    const existing = await admin
      .from("onboarding_states")
      .select("completed_steps,skipped_steps,stage_data")
      .eq("workspace_id", workspace.id)
      .single();
    if (existing.error) throw new Error("state");

    const completed = new Set<string>(existing.data.completed_steps ?? []);
    const skipped = new Set<string>(existing.data.skipped_steps ?? []);
    if (parsed.data.action === "complete") {
      completed.add(parsed.data.stage);
      skipped.delete(parsed.data.stage);
    } else if (parsed.data.action === "skip") {
      skipped.add(parsed.data.stage);
      completed.delete(parsed.data.stage);
    }

    const stageData = {
      ...(existing.data.stage_data as Record<string, unknown>),
      [parsed.data.stage]: parsed.data.data
    };
    const now = new Date().toISOString();
    const updated = await admin
      .from("onboarding_states")
      .update({
        current_step: parsed.data.stage,
        completed_steps: [...completed],
        skipped_steps: [...skipped],
        stage_data: stageData,
        last_saved_at: now,
        updated_at: now
      })
      .eq("workspace_id", workspace.id);
    if (updated.error) throw new Error("update");

    if (parsed.data.stage === "welcome") {
      const data = parsed.data.data;
      if (typeof data.workspaceName === "string" && data.workspaceName.length >= 2) {
        await admin.from("workspaces").update({ name: data.workspaceName }).eq("id", workspace.id);
      }
      await admin
        .from("workspace_settings")
        .update({
          timezone: typeof data.timezone === "string" ? data.timezone : "UTC",
          default_locale: ["en", "tr", "fa"].includes(String(data.defaultLocale))
            ? data.defaultLocale
            : "en",
          preferred_theme: ["light", "dark", "system"].includes(String(data.preferredTheme))
            ? data.preferredTheme
            : "system",
          business_category:
            typeof data.category === "string" && data.category ? data.category : null,
          country_code:
            typeof data.country === "string" && /^[A-Z]{2}$/.test(data.country)
              ? data.country
              : null,
          updated_at: now
        })
        .eq("workspace_id", workspace.id);
    }

    if (parsed.data.stage === "business-profile") {
      const data = parsed.data.data;
      await admin
        .from("business_profiles")
        .update({
          brand_name:
            typeof data.publicName === "string" && data.publicName
              ? data.publicName
              : workspace.name,
          description: typeof data.description === "string" ? data.description : "",
          updated_at: now
        })
        .eq("workspace_id", workspace.id);
    }

    if (parsed.data.stage === "languages") {
      const data = parsed.data.data;
      const tone = data.tone === "formal" ? "formal" : "friendly";
      const answerLength = data.responseLength === "medium" ? "medium" : "short";
      const emojiPolicy = ["allowed", "limited", "off"].includes(String(data.emoji))
        ? data.emoji
        : "limited";
      await admin
        .from("business_profiles")
        .update({
          primary_language:
            typeof data.replyLanguage === "string" && data.replyLanguage
              ? data.replyLanguage
              : "en",
          fallback_language: "en",
          tone,
          answer_length: answerLength,
          emoji_policy: emojiPolicy,
          escalation_keywords:
            typeof data.escalation === "string"
              ? data.escalation
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean)
                  .slice(0, 20)
              : [],
          updated_at: now
        })
        .eq("workspace_id", workspace.id);
    }

    if (parsed.data.stage === "knowledge") {
      const data = parsed.data.data;
      await admin
        .from("business_profiles")
        .update({
          forbidden_claims:
            typeof data.forbidden === "string"
              ? data.forbidden
                  .split("\n")
                  .map((value) => value.trim())
                  .filter(Boolean)
                  .slice(0, 30)
              : [],
          updated_at: now
        })
        .eq("workspace_id", workspace.id);

      if (
        parsed.data.action === "complete" &&
        typeof data.faqQuestion === "string" &&
        data.faqQuestion &&
        typeof data.faqAnswer === "string" &&
        data.faqAnswer
      ) {
        const existingFaq = await admin
          .from("business_faq_items")
          .select("id")
          .eq("workspace_id", workspace.id)
          .eq("question", data.faqQuestion)
          .maybeSingle();
        if (existingFaq.data) {
          await admin
            .from("business_faq_items")
            .update({ answer: data.faqAnswer, enabled: true })
            .eq("workspace_id", workspace.id)
            .eq("id", existingFaq.data.id);
        } else {
          await admin.from("business_faq_items").insert({
            workspace_id: workspace.id,
            question: data.faqQuestion,
            answer: data.faqAnswer,
            language: typeof data.faqLanguage === "string" ? data.faqLanguage : "en"
          });
        }
      }

      const amount = Math.round(Number(data.priceAmount) * 100);
      if (
        parsed.data.action === "complete" &&
        typeof data.priceName === "string" &&
        data.priceName &&
        Number.isSafeInteger(amount) &&
        amount >= 0 &&
        typeof data.currency === "string" &&
        /^[A-Z]{3}$/.test(data.currency)
      ) {
        const existingPrice = await admin
          .from("business_price_items")
          .select("id")
          .eq("workspace_id", workspace.id)
          .eq("name", data.priceName)
          .maybeSingle();
        const price = {
          description: typeof data.priceDescription === "string" ? data.priceDescription : "",
          amount_minor: amount,
          currency: data.currency,
          availability: "available",
          enabled: true
        };
        if (existingPrice.data) {
          await admin
            .from("business_price_items")
            .update(price)
            .eq("workspace_id", workspace.id)
            .eq("id", existingPrice.data.id);
        } else {
          await admin.from("business_price_items").insert({
            workspace_id: workspace.id,
            name: data.priceName,
            ...price
          });
        }
      }
    }

    if (parsed.data.stage === "ai-mode") {
      const data = parsed.data.data;
      const allowedModes = [
        "PLATFORM_PAID_DEFAULT",
        "WORKSPACE_BYOK_GEMINI",
        "WORKSPACE_BYOK_OPENAI",
        "WORKSPACE_BYOK_ANTHROPIC",
        "FREE_GEMINI_DEMO_SYNTHETIC_ONLY"
      ];
      const aiMode = allowedModes.includes(String(data.mode))
        ? data.mode
        : "FREE_GEMINI_DEMO_SYNTHETIC_ONLY";
      const threshold = Number(data.confidence);
      await admin
        .from("business_profiles")
        .update({
          ai_mode: aiMode,
          demo_mode_enabled: aiMode === "FREE_GEMINI_DEMO_SYNTHETIC_ONLY",
          low_confidence_threshold:
            Number.isFinite(threshold) && threshold >= 0 && threshold <= 1 ? threshold : 0.75,
          updated_at: now
        })
        .eq("workspace_id", workspace.id);
    }

    return NextResponse.json({
      completed: [...completed],
      skipped: [...skipped],
      lastSavedAt: now
    });
  } catch {
    return NextResponse.json({ error: "ONBOARDING_UPDATE_FAILED" }, { status: 400 });
  }
}
