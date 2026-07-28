import type { SupabaseClient } from "@supabase/supabase-js";
import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import {
  businessProfileInputSchema,
  type BusinessProfile,
  type BusinessProfileInput,
  type CredentialStatus,
  type FaqItem,
  type PriceItem
} from "./contracts";

export class BusinessProfileRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly workspace: TrustedWorkspace
  ) {}
  async get(): Promise<{
    profile: BusinessProfile;
    faqs: FaqItem[];
    prices: PriceItem[];
    credentials: CredentialStatus[];
  }> {
    const [profile, faqs, prices, credentials] = await Promise.all([
      this.client
        .from("business_profiles")
        .select("*")
        .eq("workspace_id", this.workspace.id)
        .single(),
      this.client
        .from("business_faq_items")
        .select("*")
        .eq("workspace_id", this.workspace.id)
        .order("created_at"),
      this.client
        .from("business_price_items")
        .select("*")
        .eq("workspace_id", this.workspace.id)
        .order("created_at"),
      this.client
        .from("workspace_ai_credentials")
        .select("provider,status,masked_suffix,key_version")
        .eq("workspace_id", this.workspace.id)
    ]);
    if (profile.error) throw new Error("Business profile unavailable.");
    const row = profile.data;
    return {
      profile: {
        workspaceId: this.workspace.id,
        brandName: row.brand_name,
        description: row.description,
        primaryLanguage: row.primary_language,
        fallbackLanguage: row.fallback_language,
        tone: row.tone,
        answerLength: row.answer_length,
        emojiPolicy: row.emoji_policy,
        businessHours: row.business_hours,
        timezone: row.timezone,
        forbiddenClaims: row.forbidden_claims,
        escalationKeywords: row.escalation_keywords,
        lowConfidenceThreshold: Number(row.low_confidence_threshold),
        retentionDays: row.retention_days,
        aiMode: row.ai_mode,
        demoModeEnabled: row.demo_mode_enabled
      },
      faqs: (faqs.data ?? []).map((item) => ({
        id: item.id,
        question: item.question,
        answer: item.answer,
        language: item.language,
        enabled: item.enabled
      })),
      prices: (prices.data ?? []).map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        amountMinor: Number(item.amount_minor),
        currency: item.currency,
        availability: item.availability,
        enabled: item.enabled
      })),
      credentials: (credentials.data ?? []).map((item) => ({
        provider: item.provider,
        status: item.status,
        maskedSuffix: item.masked_suffix,
        keyVersion: item.key_version
      }))
    };
  }
  async update(input: BusinessProfileInput) {
    const value = businessProfileInputSchema.parse(input);
    const { error } = await this.client
      .from("business_profiles")
      .update({
        brand_name: value.brandName,
        description: value.description,
        primary_language: value.primaryLanguage,
        fallback_language: value.fallbackLanguage,
        tone: value.tone,
        answer_length: value.answerLength,
        emoji_policy: value.emojiPolicy,
        business_hours: value.businessHours,
        timezone: value.timezone,
        forbidden_claims: value.forbiddenClaims,
        escalation_keywords: value.escalationKeywords,
        low_confidence_threshold: value.lowConfidenceThreshold,
        retention_days: value.retentionDays,
        ai_mode: value.aiMode,
        demo_mode_enabled: value.demoModeEnabled,
        updated_at: new Date().toISOString()
      })
      .eq("workspace_id", this.workspace.id);
    if (error) throw new Error("Business profile update failed.");
  }
  async addFaq(input: { question: string; answer: string; language: string }) {
    const { error } = await this.client
      .from("business_faq_items")
      .insert({ workspace_id: this.workspace.id, ...input });
    if (error) throw new Error("FAQ update failed.");
  }
  async addPrice(input: {
    name: string;
    description: string;
    amountMinor: number;
    currency: string;
    availability: string;
  }) {
    const { error } = await this.client.from("business_price_items").insert({
      workspace_id: this.workspace.id,
      name: input.name,
      description: input.description,
      amount_minor: input.amountMinor,
      currency: input.currency.toUpperCase(),
      availability: input.availability
    });
    if (error) throw new Error("Price update failed.");
  }
}
