import Link from "next/link";

import { getRequestPreferences } from "@/src/lib/i18n/server";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";
import { BillingEntitlementError } from "@/src/modules/billing/entitlement-gate";
import { EntitlementBlocked } from "@/src/modules/billing/ui/entitlement-blocked";

const recipes = [
  {
    id: "INSTAGRAM_COMMENT_TO_DM",
    name: "Instagram comment → permitted private reply → DM lead collection",
    goal: "Turn an eligible post or Reel response into an owner-approved DM qualification flow.",
    trigger: "Matching comment on a configured media object",
    collects: "Configured fields, consent-safe conversation data and private images",
    ai: "Extracts fields and answers only from approved knowledge",
    policy: "One private reply in-window; the person must respond before the DM flow continues",
    setup: "8–12 minutes"
  },
  {
    id: "INSTAGRAM_INBOUND_DM",
    name: "Instagram inbound DM qualification",
    goal: "Qualify a person who initiates a permitted Instagram conversation.",
    trigger: "Trusted inbound Instagram DM",
    collects: "Questions, images, source and timeline",
    ai: "Answers approved FAQ and price questions",
    policy: "No cold DM; low confidence or missing facts require a person",
    setup: "6–10 minutes"
  },
  {
    id: "WHATSAPP_INBOUND",
    name: "WhatsApp inbound lead collection",
    goal: "Collect a complete lead record after the customer initiates or replies.",
    trigger: "Trusted inbound WhatsApp message",
    collects: "Questions, images, opt-out and service-window evidence",
    ai: "Extracts fields and suggests approved answers",
    policy: "Free-form messages require the open 24-hour service window",
    setup: "6–10 minutes"
  },
  {
    id: "WHATSAPP_CONSENTED_FOLLOWUP_REMINDER",
    name: "WhatsApp consented reminder",
    goal: "Send one approved reminder only when consent, opt-in and template policy allow it.",
    trigger: "Trusted internal schedule",
    collects: "Consent, template, attempt and delivery evidence",
    ai: "May select approved context; never grants send authority",
    policy: "Approved template and explicit opt-in are mandatory outside the window",
    setup: "8–12 minutes"
  },
  {
    id: "CROSS_CHANNEL_AFTER_HOURS_ESCALATION",
    name: "After-hours or low-confidence human handoff",
    goal: "Create a clear owner task without unsolicited cross-channel contact.",
    trigger: "After-hours, low confidence or missing approved knowledge",
    collects: "Reason, conversation, customer and recovery context",
    ai: "Explains why human review is needed",
    policy: "Creates human review and sends nothing across channels",
    setup: "4–6 minutes"
  }
] as const;

export default async function RecipeGalleryPage() {
  const { locale } = await getRequestPreferences();
  let workspace: Awaited<ReturnType<typeof createMetaRuntime>>["workspace"];
  try {
    ({ workspace } = await createMetaRuntime());
  } catch (error) {
    if (error instanceof BillingEntitlementError) {
      return (
        <WorkspaceShell active="automations" workspaceName={error.workspace.name}>
          <div className="content">
            <EntitlementBlocked locale={locale} status={error.status} />
          </div>
        </WorkspaceShell>
      );
    }
    throw error;
  }
  const pick = (en: string, tr: string, fa: string) =>
    locale === "tr" ? tr : locale === "fa" ? fa : en;
  const recipeNames: Record<(typeof recipes)[number]["id"], readonly [string, string]> = {
    INSTAGRAM_COMMENT_TO_DM: [
      "Instagram yorumundan DM müşteri adayına",
      "تبدیل نظر اینستاگرام به سرنخ دایرکت"
    ],
    INSTAGRAM_INBOUND_DM: ["Instagram gelen DM nitelendirme", "ارزیابی دایرکت ورودی اینستاگرام"],
    WHATSAPP_INBOUND: ["WhatsApp gelen müşteri adayı", "جمع‌آوری سرنخ ورودی واتساپ"],
    WHATSAPP_CONSENTED_FOLLOWUP_REMINDER: ["İzinli WhatsApp hatırlatması", "یادآوری مجاز واتساپ"],
    CROSS_CHANNEL_AFTER_HOURS_ESCALATION: [
      "Mesai dışı insan yönlendirmesi",
      "ارجاع انسانی خارج از ساعات کاری"
    ]
  };
  return (
    <WorkspaceShell active="automations" workspaceName={workspace.name}>
      <div className="content">
        <header className="page-intro">
          <span className="eyebrow">
            {pick("Safe starting points", "Güvenli başlangıçlar", "شروع‌های امن")}
          </span>
          <h2>{pick("Recipe gallery", "Tarif galerisi", "گالری دستورها")}</h2>
          <p>
            {pick(
              "Each recipe has a fixed policy boundary. Publishing never enables real sending.",
              "Her tarifin sabit bir politika sınırı vardır. Yayınlamak gerçek gönderimi açmaz.",
              "هر دستور مرز سیاستی ثابتی دارد؛ انتشار، ارسال واقعی را فعال نمی‌کند."
            )}
          </p>
        </header>
        <section className="recipe-catalog">
          {recipes.map((recipe) => (
            <article key={recipe.id}>
              <span className="eyebrow">{recipe.setup}</span>
              <h3>
                {locale === "en" ? recipe.name : recipeNames[recipe.id][locale === "tr" ? 0 : 1]}
              </h3>
              <p>
                {pick(
                  recipe.goal,
                  "Yalnızca güvenilir gelen olayları güvenli bir CRM akışına dönüştürür.",
                  "فقط رویدادهای ورودی معتبر را به مسیر امن CRM تبدیل می‌کند."
                )}
              </p>
              <dl>
                <div>
                  <dt>{pick("Trigger", "Tetikleyici", "محرک")}</dt>
                  <dd>
                    {pick(
                      recipe.trigger,
                      "Doğrulanmış sağlayıcı veya iç olay",
                      "رویداد تأییدشده ارائه‌دهنده یا سامانه"
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{pick("Collects", "Toplananlar", "داده‌های جمع‌آوری‌شده")}</dt>
                  <dd>
                    {pick(
                      recipe.collects,
                      "Onaylı alanlar, izin ve zaman çizelgesi kanıtı",
                      "فیلدهای تأییدشده، رضایت و شواهد خط زمانی"
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{pick("AI role", "Yapay zekâ rolü", "نقش هوش مصنوعی")}</dt>
                  <dd>
                    {pick(
                      recipe.ai,
                      "Alanları yorumlar; gönderim yetkisi vermez",
                      "فیلدها را تفسیر می‌کند؛ مجوز ارسال نمی‌دهد"
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{pick("Policy limit", "Politika sınırı", "محدودیت سیاست")}</dt>
                  <dd>
                    {pick(
                      recipe.policy,
                      "Politika motoru her adımda izin, pencere ve durdurma kurallarını denetler",
                      "موتور سیاست در هر گام رضایت، پنجره زمانی و توقف را بررسی می‌کند"
                    )}
                  </dd>
                </div>
              </dl>
              <Link href={`/automations?recipe=${recipe.id}#new`}>
                {pick("Use this recipe", "Bu tarifi kullan", "استفاده از این دستور")}
              </Link>
            </article>
          ))}
        </section>
      </div>
    </WorkspaceShell>
  );
}
