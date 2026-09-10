import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { requireCsrf } from "@/src/modules/auth/security/route";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
import {
  businessHoursFrom,
  openingHoursFaq,
  openingHoursQuestions,
  readStage,
  setupStages,
  validateStage,
  type SetupDraft
} from "@/src/modules/workspaces/onboarding/setup-plan";
import { assertWorkspaceManager } from "@/src/modules/workspaces/server/resolve-workspace";

const safeValue = z.union([
  z.string().trim().max(2_000),
  // Not `.finite()`: deprecated in zod 4, where a plain number already rejects
  // NaN and both infinities. Same values accepted, one fewer deprecation.
  z.number(),
  z.boolean(),
  z.array(z.string().trim().max(200)).max(20)
]);
const requestSchema = z.object({
  stage: z.enum(setupStages),
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

    const { stage, action } = parsed.data;
    const data = parsed.data.data as SetupDraft;

    // Two different questions, deliberately answered differently. Autosave runs
    // on every blur, so refusing a half-typed field would turn ordinary typing
    // into an error message; `readStage` simply omits what it cannot use and
    // the stage keeps its draft. Marking a stage complete is a person saying
    // they are done with it, and that claim is checked - otherwise the
    // "jhj"/"w" rows get written by somebody who pressed Continue.
    const issues = validateStage(stage, data);
    if (action === "complete" && Object.keys(issues).length > 0) {
      return NextResponse.json(
        { error: "INVALID_ONBOARDING_FIELDS", fields: issues },
        { status: 400 }
      );
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
    if (action === "complete") {
      completed.add(stage);
      skipped.delete(stage);
    } else if (action === "skip") {
      skipped.add(stage);
      completed.delete(stage);
    }

    const stageData = {
      ...(existing.data.stage_data as Record<string, unknown>),
      [stage]: data
    };
    const now = new Date().toISOString();
    const updated = await admin
      .from("onboarding_states")
      .update({
        current_step: stage,
        completed_steps: [...completed],
        skipped_steps: [...skipped],
        stage_data: stageData,
        last_saved_at: now,
        updated_at: now
      })
      .eq("workspace_id", workspace.id);
    if (updated.error) throw new Error("update");

    // Skipping is the one action that stores nothing beyond the skip itself.
    // Every stage carries defaults now, and honouring them here would mean a
    // person who pressed "Skip for now" on the hours stage got seven days of
    // opening times they never looked at, published as an approved answer.
    if (action === "skip") {
      return NextResponse.json({
        completed: [...completed],
        skipped: [...skipped],
        lastSavedAt: now
      });
    }

    const values = readStage(data);
    const profile: Record<string, unknown> = {};

    if (stage === "welcome") {
      if (values.workspaceName) {
        await admin
          .from("workspaces")
          .update({ name: values.workspaceName })
          .eq("id", workspace.id);
        // The public name the assistant belongs to is the workspace's name.
        // Asking for both produced two fields that were the same answer twice
        // and could drift apart, and only one of them was ever read.
        profile.brand_name = values.workspaceName;
      }
      if (values.replyLanguage) profile.primary_language = values.replyLanguage;
      await admin
        .from("workspace_settings")
        .update({
          default_locale: ["en", "tr", "fa"].includes(String(data.defaultLocale))
            ? data.defaultLocale
            : "en",
          preferred_theme: ["light", "dark", "system"].includes(String(data.preferredTheme))
            ? data.preferredTheme
            : "system",
          updated_at: now
        })
        .eq("workspace_id", workspace.id);
    }

    if (stage === "hours") {
      profile.business_hours = businessHoursFrom(data);
      if (values.timezone) {
        profile.timezone = values.timezone;
        // Two columns hold a timezone and both are read: `workspace_settings`
        // by the workspace shell, `business_profiles` by the settings panel.
        // Onboarding wrote only the first, so the profile every reply is
        // composed against kept saying UTC.
        await admin
          .from("workspace_settings")
          .update({ timezone: values.timezone, updated_at: now })
          .eq("workspace_id", workspace.id);
      }
      await upsertOpeningHoursFaq(admin, workspace.id, data);
    }

    if (stage === "knowledge") {
      if (values.faq) {
        const { question, answer } = values.faq;
        const existingFaq = await admin
          .from("business_faq_items")
          .select("id")
          .eq("workspace_id", workspace.id)
          .eq("question", question)
          .maybeSingle();
        if (existingFaq.data) {
          await admin
            .from("business_faq_items")
            .update({ answer, enabled: true })
            .eq("workspace_id", workspace.id)
            .eq("id", existingFaq.data.id);
        } else {
          await admin.from("business_faq_items").insert({
            workspace_id: workspace.id,
            question,
            answer,
            language: await primaryLanguage(admin, workspace.id)
          });
        }
      }

      if (values.price) {
        const { name, amountMinor, currency } = values.price;
        const existingPrice = await admin
          .from("business_price_items")
          .select("id")
          .eq("workspace_id", workspace.id)
          .eq("name", name)
          .maybeSingle();
        const price = {
          amount_minor: amountMinor,
          currency,
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
          await admin
            .from("business_price_items")
            .insert({ workspace_id: workspace.id, name, ...price });
        }
      }
    }

    if (stage === "limits") {
      profile.escalation_keywords = [...values.escalationKeywords];
      profile.forbidden_claims = [...values.forbiddenClaims];
      if (values.handover !== undefined) profile.low_confidence_threshold = values.handover;
    }

    if (stage === "assistant") {
      if (values.mode) {
        profile.ai_mode = values.mode;
        profile.demo_mode_enabled = values.mode === "FREE_GEMINI_DEMO_SYNTHETIC_ONLY";
      }
      if (values.tone) profile.tone = values.tone;
    }

    if (Object.keys(profile).length > 0) {
      await admin
        .from("business_profiles")
        .update({ ...profile, updated_at: now })
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

type Admin = Awaited<ReturnType<typeof createSupabaseAdminClient>>;

async function primaryLanguage(admin: Admin, workspaceId: string): Promise<string> {
  const { data } = await admin
    .from("business_profiles")
    .select("primary_language")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return typeof data?.primary_language === "string" ? data.primary_language : "en";
}

/**
 * Keeps the workspace's opening hours available as an approved answer.
 *
 * The hours themselves are only an allowlist - the model never sees them - so
 * without this the most-asked question of all goes to a person on a workspace
 * that answered it during setup. Matched against every wording this has ever
 * generated so that changing the reply language rewrites the entry rather than
 * adding a second one, and skipped when the answer is already correct so that
 * blurring a time field is not a write.
 */
async function upsertOpeningHoursFaq(admin: Admin, workspaceId: string, draft: SetupDraft) {
  const language = await primaryLanguage(admin, workspaceId);
  const { question, answer } = openingHoursFaq(draft, language);
  const { data } = await admin
    .from("business_faq_items")
    .select("id,question,answer")
    .eq("workspace_id", workspaceId)
    .in("question", Object.values(openingHoursQuestions))
    .limit(1);
  const row = data?.[0];
  if (!row) {
    await admin
      .from("business_faq_items")
      .insert({ workspace_id: workspaceId, question, answer, language });
    return;
  }
  if (row.question === question && row.answer === answer) return;
  await admin
    .from("business_faq_items")
    .update({ question, answer, language, enabled: true })
    .eq("workspace_id", workspaceId)
    .eq("id", row.id);
}
