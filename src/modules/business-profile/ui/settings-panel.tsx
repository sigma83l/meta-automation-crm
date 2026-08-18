"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useI18n } from "@/src/lib/i18n/client";
import { PreferenceControls } from "@/src/modules/workspaces/ui/preference-controls";
import type { BusinessProfile, CredentialStatus, FaqItem, PriceItem } from "../contracts";

async function csrf() {
  return ((await fetch("/api/auth/csrf").then((r) => r.json())) as { token: string }).token;
}
async function mutate(url: string, method: string, body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json", "x-csrf-token": await csrf() },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error("The setting could not be saved.");
  return response.json();
}
export function SettingsPanel({
  profile,
  faqs,
  prices,
  credentials,
  memberships
}: {
  profile: BusinessProfile;
  faqs: FaqItem[];
  prices: PriceItem[];
  credentials: CredentialStatus[];
  memberships: ReadonlyArray<{
    id: string;
    role: string;
    status: string;
    created_at: string;
  }>;
}) {
  const { text } = useI18n();
  const [message, setMessage] = useState("");
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await mutate("/api/settings/business-profile", "PATCH", {
        brandName: form.get("brandName"),
        description: form.get("description"),
        primaryLanguage: form.get("primaryLanguage"),
        fallbackLanguage: form.get("fallbackLanguage"),
        tone: form.get("tone"),
        answerLength: form.get("answerLength"),
        emojiPolicy: form.get("emojiPolicy"),
        businessHours: Object.fromEntries(
          String(form.get("businessHours") ?? "")
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const [day, ...hours] = line.split(":");
              return [day!.trim(), hours.join(":").trim()];
            })
        ),
        timezone: form.get("timezone"),
        forbiddenClaims: String(form.get("forbiddenClaims") ?? "")
          .split("\n")
          .filter(Boolean),
        escalationKeywords: String(form.get("escalationKeywords") ?? "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
        lowConfidenceThreshold: Number(form.get("lowConfidenceThreshold")),
        retentionDays: Number(form.get("retentionDays")),
        aiMode: form.get("aiMode"),
        demoModeEnabled: form.get("demoModeEnabled") === "on"
      });
      setMessage(
        text("Business profile saved.", "İşletme profili kaydedildi.", "پروفایل کسب‌وکار ذخیره شد.")
      );
    } catch {
      setMessage(
        text(
          "The business profile could not be saved. Check the fields and try again.",
          "İşletme profili kaydedilemedi. Alanları kontrol edip yeniden deneyin.",
          "پروفایل کسب‌وکار ذخیره نشد. فیلدها را بررسی و دوباره تلاش کنید."
        )
      );
    }
  }
  async function addFaq(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate("/api/settings/faqs", "POST", Object.fromEntries(form));
    location.reload();
  }
  async function addPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate("/api/settings/prices", "POST", {
      ...Object.fromEntries(form),
      amountMinor: Math.round(Number(form.get("amount")) * 100)
    });
    location.reload();
  }
  async function credential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await mutate("/api/settings/ai-credentials", "POST", {
        provider: form.get("provider"),
        key: form.get("key")
      });
      setMessage(
        text(
          "Credential encrypted and stored. Test it before use.",
          "Kimlik bilgisi şifrelenip kaydedildi. Kullanmadan önce test edin.",
          "کلید رمزگذاری و ذخیره شد؛ پیش از استفاده آن را بیازمایید."
        )
      );
      location.reload();
    } catch {
      setMessage(
        text(
          "The credential could not be stored. Verify the provider and try again.",
          "Kimlik bilgisi saklanamadı. Sağlayıcıyı doğrulayıp yeniden deneyin.",
          "کلید ذخیره نشد. ارائه‌دهنده را بررسی و دوباره تلاش کنید."
        )
      );
    }
  }
  async function logoutAll() {
    const response = await fetch("/api/auth/logout-all", {
      method: "POST",
      headers: { "x-csrf-token": await csrf() }
    });
    if (response.ok) location.assign("/login");
  }
  return (
    <div className="settings-stack">
      <nav
        className="section-nav"
        aria-label={text("Settings groups", "Ayar grupları", "گروه‌های تنظیمات")}
      >
        <a href="#business">{text("Business", "İşletme", "کسب‌وکار")}</a>
        <a href="#knowledge">{text("Knowledge", "Bilgi", "دانش")}</a>
        <a href="#ai-provider">{text("AI provider", "Yapay zekâ", "هوش مصنوعی")}</a>
        <a href="#team">{text("Team & roles", "Ekip ve roller", "تیم و نقش‌ها")}</a>
        <a href="#workspace-controls">
          {text("Security & data", "Güvenlik ve veri", "امنیت و داده")}
        </a>
      </nav>
      {message && (
        <p className="form-status" role="status">
          {message}
        </p>
      )}
      <form className="settings-card" id="business" onSubmit={saveProfile}>
        <h2>{text("Business Profile", "İşletme Profili", "پروفایل کسب‌وکار")}</h2>
        <div className="form-grid">
          <label>
            {text("Brand name", "Marka adı", "نام برند")}
            <input name="brandName" defaultValue={profile.brandName} required />
          </label>
          <label>
            {text("Timezone", "Saat dilimi", "منطقه زمانی")}
            <input name="timezone" defaultValue={profile.timezone} required />
          </label>
          <label className="wide">
            {text(
              "Business hours (one day:value per line)",
              "Çalışma saatleri (satır başına gün:değer)",
              "ساعات کاری (هر خط روز:مقدار)"
            )}
            <textarea
              name="businessHours"
              defaultValue={Object.entries(profile.businessHours)
                .map(([day, hours]) => `${day}:${hours}`)
                .join("\n")}
              placeholder="monday:09:00-17:00"
            />
          </label>
          <label className="wide">
            {text("Description", "Açıklama", "توضیحات")}
            <textarea name="description" defaultValue={profile.description} />
          </label>
          <label>
            {text("Primary language", "Birincil dil", "زبان اصلی")}
            <input name="primaryLanguage" defaultValue={profile.primaryLanguage} />
          </label>
          <label>
            {text("Fallback language", "Yedek dil", "زبان جایگزین")}
            <input name="fallbackLanguage" defaultValue={profile.fallbackLanguage} />
          </label>
          <label>
            {text("Tone", "Üslup", "لحن")}
            <select name="tone" defaultValue={profile.tone}>
              <option>friendly</option>
              <option>formal</option>
            </select>
          </label>
          <label>
            {text("Answer length", "Yanıt uzunluğu", "طول پاسخ")}
            <select name="answerLength" defaultValue={profile.answerLength}>
              <option>short</option>
              <option>medium</option>
            </select>
          </label>
          <label>
            {text("Emoji policy", "Emoji politikası", "سیاست ایموجی")}
            <select name="emojiPolicy" defaultValue={profile.emojiPolicy}>
              <option>allowed</option>
              <option>limited</option>
              <option>off</option>
            </select>
          </label>
          <label>
            {text("Retention days", "Saklama günü", "روزهای نگهداری")}
            <input
              name="retentionDays"
              type="number"
              min="1"
              max="3650"
              defaultValue={profile.retentionDays}
            />
          </label>
          <label>
            {text("Human-review threshold", "İnsan inceleme eşiği", "آستانه بررسی انسانی")}
            <input
              name="lowConfidenceThreshold"
              type="number"
              min="0"
              max="1"
              step=".01"
              defaultValue={profile.lowConfidenceThreshold}
            />
          </label>
          <label className="wide">
            {text("Forbidden claims", "Yasak iddialar", "ادعاهای ممنوع")}
            <textarea name="forbiddenClaims" defaultValue={profile.forbiddenClaims.join("\n")} />
          </label>
          <label className="wide">
            {text("Escalation keywords", "Yönlendirme anahtarları", "کلیدواژه‌های ارجاع")}
            <input name="escalationKeywords" defaultValue={profile.escalationKeywords.join(", ")} />
          </label>
        </div>
        <h2>
          {text(
            "AI Style & Provider",
            "Yapay zekâ üslubu ve sağlayıcı",
            "سبک و ارائه‌دهنده هوش مصنوعی"
          )}
        </h2>
        <label>
          {text("AI mode", "Yapay zekâ modu", "حالت هوش مصنوعی")}
          <select name="aiMode" defaultValue={profile.aiMode}>
            <option value="PLATFORM_PAID_DEFAULT">Platform paid default</option>
            <option value="WORKSPACE_BYOK_GEMINI">Workspace BYOK — Gemini</option>
            <option value="WORKSPACE_BYOK_OPENAI">Workspace BYOK — OpenAI</option>
            <option value="WORKSPACE_BYOK_ANTHROPIC">Workspace BYOK — Anthropic</option>
            <option value="FREE_GEMINI_DEMO_SYNTHETIC_ONLY">
              Free Gemini — synthetic Demo only
            </option>
          </select>
        </label>
        <label className="check">
          <input name="demoModeEnabled" type="checkbox" defaultChecked={profile.demoModeEnabled} />{" "}
          {text("Explicit Demo mode", "Açık Demo modu", "حالت نمایشی صریح")}
        </label>
        <p className="warning-box">
          {text(
            "Free Gemini is prohibited for webhooks, CRM records, customer messages, and media. It never receives real data and is never an automatic fallback.",
            "Ücretsiz Gemini webhook, CRM kaydı, müşteri mesajı ve medya için yasaktır. Gerçek veri almaz ve otomatik yedek değildir.",
            "Gemini رایگان برای وب‌هوک، CRM، پیام و رسانه مشتری ممنوع است؛ داده واقعی دریافت نمی‌کند و جایگزین خودکار نیست."
          )}
        </p>
        <button type="submit">{text("Save profile", "Profili kaydet", "ذخیره پروفایل")}</button>
      </form>
      <div className="settings-columns" id="knowledge">
        <form className="settings-card" onSubmit={addFaq}>
          <h2>{text("FAQs", "Sık sorulanlar", "پرسش‌های متداول")}</h2>
          {faqs.map((item) => (
            <p key={item.id}>
              <strong>{item.question}</strong>
              <br />
              {item.answer}
            </p>
          ))}
          <label>
            {text("Question", "Soru", "پرسش")}
            <input name="question" required />
          </label>
          <label>
            {text("Answer", "Yanıt", "پاسخ")}
            <textarea name="answer" required />
          </label>
          <input name="language" defaultValue={profile.primaryLanguage} hidden />
          <button>{text("Add FAQ", "SSS ekle", "افزودن پرسش")}</button>
        </form>
        <form className="settings-card" onSubmit={addPrice}>
          <h2>{text("Pricing", "Fiyatlandırma", "قیمت‌گذاری")}</h2>
          {prices.map((item) => (
            <p key={item.id}>
              <strong>{item.name}</strong> — {(item.amountMinor / 100).toFixed(2)} {item.currency}
            </p>
          ))}
          <label>
            {text("Name", "Ad", "نام")}
            <input name="name" required />
          </label>
          <label>
            {text("Description", "Açıklama", "توضیحات")}
            <input name="description" />
          </label>
          <label>
            {text("Amount", "Tutar", "مبلغ")}
            <input name="amount" type="number" min="0" step=".01" required />
          </label>
          <label>
            {text("Currency", "Para birimi", "واحد پول")}
            <input name="currency" defaultValue="USD" pattern="[A-Za-z]{3}" required />
          </label>
          <label>
            {text("Availability", "Uygunluk", "دسترس‌پذیری")}
            <select name="availability">
              <option value="available">Available</option>
              <option value="unavailable">Unavailable</option>
              <option value="ask_human">Ask human</option>
            </select>
          </label>
          <button>{text("Add price", "Fiyat ekle", "افزودن قیمت")}</button>
        </form>
      </div>
      <form className="settings-card" id="ai-provider" onSubmit={credential}>
        <h2>
          {text(
            "Encrypted BYOK credentials",
            "Şifreli BYOK kimlik bilgileri",
            "کلیدهای رمزگذاری‌شده BYOK"
          )}
        </h2>
        <p>
          {text(
            "Keys are accepted only by a server route, encrypted with AES-256-GCM, and never returned.",
            "Anahtarlar yalnızca sunucuda alınır, AES-256-GCM ile şifrelenir ve geri döndürülmez.",
            "کلیدها فقط در سرور دریافت، با AES-256-GCM رمزگذاری و هرگز بازگردانده نمی‌شوند."
          )}
        </p>
        {credentials.map((item) => (
          <div className="credential-row" key={item.provider}>
            <span>
              <strong>{item.provider}</strong> ••••{item.maskedSuffix} · {item.status}
            </span>
            <button
              type="button"
              onClick={() =>
                mutate("/api/settings/ai-credentials", "PATCH", { provider: item.provider }).then(
                  () => location.reload()
                )
              }
            >
              {text("Test", "Test et", "آزمون")}
            </button>
            <button
              type="button"
              className="button-muted"
              onClick={() =>
                mutate("/api/settings/ai-credentials", "DELETE", { provider: item.provider }).then(
                  () => location.reload()
                )
              }
            >
              {text("Delete", "Sil", "حذف")}
            </button>
          </div>
        ))}
        <label>
          {text("Provider", "Sağlayıcı", "ارائه‌دهنده")}
          <select name="provider">
            <option>gemini</option>
            <option>openai</option>
            <option>anthropic</option>
          </select>
        </label>
        <label>
          {text("New or replacement key", "Yeni veya yedek anahtar", "کلید جدید یا جایگزین")}
          <input name="key" type="password" minLength={12} autoComplete="off" required />
        </label>
        <button>{text("Encrypt and store", "Şifrele ve sakla", "رمزگذاری و ذخیره")}</button>
      </form>
      <section className="settings-card" id="team">
        <h2>{text("Team & roles", "Ekip ve roller", "تیم و نقش‌ها")}</h2>
        <p>
          {text(
            "Roles are enforced in the database and service layer. Invitations require verified email delivery and are not enabled yet.",
            "Roller veritabanında ve servis katmanında uygulanır. Davetler doğrulanmış e-posta teslimi gerektirir ve henüz açık değildir.",
            "نقش‌ها در پایگاه‌داده و لایه سرویس اعمال می‌شوند. دعوت همکار به ایمیل تأییدشده نیاز دارد و هنوز فعال نیست."
          )}
        </p>
        <div className="team-list">
          {memberships.map((membership, index) => (
            <article key={membership.id}>
              <div>
                <strong>
                  {text("Team member", "Ekip üyesi", "عضو تیم")} {index + 1}
                </strong>
                <span>{membership.status}</span>
              </div>
              <span className="status-pill">{membership.role}</span>
            </article>
          ))}
        </div>
      </section>
      <section className="settings-card">
        <h2>{text("Locale & theme", "Dil ve tema", "زبان و پوسته")}</h2>
        <PreferenceControls />
      </section>
      <section className="settings-card" aria-labelledby="workspace-controls">
        <h2 id="workspace-controls">
          {text("Workspace controls", "Çalışma alanı kontrolleri", "کنترل‌های فضای کاری")}
        </h2>
        <div className="settings-management-grid">
          <article>
            <strong>{text("Security", "Güvenlik", "امنیت")}</strong>
            <span>
              {text(
                "Server sessions, CSRF protection, encrypted credentials",
                "Sunucu oturumları, CSRF koruması, şifreli kimlik bilgileri",
                "نشست سرور، حفاظت CSRF و کلیدهای رمزگذاری‌شده"
              )}
            </span>
            <Link href="/connections">
              {text("Review connections", "Bağlantıları incele", "بررسی اتصال‌ها")}
            </Link>
          </article>
          <article>
            <strong>{text("Data retention", "Veri saklama", "نگهداری داده")}</strong>
            <span>
              {profile.retentionDays}{" "}
              {text(
                "days · adjustable in Business Profile",
                "gün · İşletme Profilinden değiştirilebilir",
                "روز · قابل تغییر در پروفایل کسب‌وکار"
              )}
            </span>
            <a href="#workspace-controls">
              {text("Review retention", "Saklamayı incele", "بررسی نگهداری")}
            </a>
          </article>
          <article>
            <strong>{text("Exports", "Dışa aktarımlar", "خروجی‌ها")}</strong>
            <span>
              {text(
                "Workspace-scoped Excel and complete ZIP packages",
                "Çalışma alanına özel Excel ve tam ZIP paketleri",
                "فایل Excel و بسته ZIP محدود به فضای کاری"
              )}
            </span>
            <Link href="/crm">
              {text("Open CRM exports", "CRM dışa aktarımlarını aç", "بازکردن خروجی‌های CRM")}
            </Link>
          </article>
          <article>
            <strong>{text("Account", "Hesap", "حساب")}</strong>
            <span>
              {text(
                "Private workspace membership and session controls",
                "Özel çalışma alanı üyeliği ve oturum kontrolleri",
                "عضویت فضای کاری خصوصی و کنترل نشست‌ها"
              )}
            </span>
            <button type="button" className="button-muted" onClick={logoutAll}>
              {text("Log out all sessions", "Tüm oturumları kapat", "خروج از همه نشست‌ها")}
            </button>
          </article>
          <article>
            <strong>{text("Billing", "Faturalandırma", "صورتحساب")}</strong>
            <span>
              {text(
                "Trial status, subscription and payment method",
                "Deneme durumu, abonelik ve ödeme yöntemi",
                "وضعیت آزمایشی، اشتراک و روش پرداخت"
              )}
            </span>
            <Link href="/settings/billing">
              {text("Manage billing", "Faturalandırmayı yönet", "مدیریت صورتحساب")}
            </Link>
          </article>
        </div>
      </section>
    </div>
  );
}
