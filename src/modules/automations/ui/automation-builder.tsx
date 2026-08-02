"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useI18n } from "@/src/lib/i18n/client";

const recipes = [
  ["INSTAGRAM_COMMENT_TO_DM"],
  ["INSTAGRAM_INBOUND_DM"],
  ["WHATSAPP_INBOUND"],
  ["WHATSAPP_CONSENTED_FOLLOWUP_REMINDER"],
  ["CROSS_CHANNEL_AFTER_HOURS_ESCALATION"]
] as const;
type RecipeId = (typeof recipes)[number][0];

async function csrf() {
  return ((await fetch("/api/auth/csrf").then((response) => response.json())) as { token: string })
    .token;
}

export function AutomationBuilder({ initialRecipe }: { initialRecipe?: string | undefined }) {
  const router = useRouter();
  const { t, text } = useI18n();
  const steps = [
    text("Basics", "Temel bilgiler", "اطلاعات پایه"),
    text("Channel & Trigger", "Kanal ve tetikleyici", "کانال و محرک"),
    text("Questions", "Sorular", "پرسش‌ها"),
    text("Business Answers", "İşletme yanıtları", "پاسخ‌های کسب‌وکار"),
    text("AI Style", "Yapay zekâ stili", "سبک هوش مصنوعی"),
    text("Rules", "Kurallar", "قوانین"),
    text("Test & Activate", "Test ve etkinleştirme", "آزمایش و فعال‌سازی")
  ] as const;
  const recipeLabel = (id: RecipeId) =>
    id === "INSTAGRAM_COMMENT_TO_DM"
      ? text(
          "Instagram Comment → DM lead collection",
          "Instagram yorumundan DM aday toplama",
          "جمع‌آوری سرنخ از نظر اینستاگرام به دایرکت"
        )
      : id === "INSTAGRAM_INBOUND_DM"
        ? text(
            "Instagram inbound DM qualification",
            "Instagram gelen DM nitelendirme",
            "ارزیابی دایرکت ورودی اینستاگرام"
          )
        : id === "WHATSAPP_INBOUND"
          ? text(
              "WhatsApp inbound lead collection",
              "WhatsApp gelen aday toplama",
              "جمع‌آوری سرنخ ورودی واتس‌اپ"
            )
          : id === "WHATSAPP_CONSENTED_FOLLOWUP_REMINDER"
            ? text(
                "WhatsApp consented reminder",
                "WhatsApp onaylı hatırlatma",
                "یادآوری رضایت‌محور واتس‌اپ"
              )
            : text(
                "After-hours human handoff",
                "Mesai dışı insan yönlendirmesi",
                "ارجاع انسانی خارج از ساعت کاری"
              );
  const [currentStep, setCurrentStep] = useState(0);
  const [recipe, setRecipe] = useState<RecipeId>(
    recipes.some(([id]) => id === initialRecipe) ? (initialRecipe as RecipeId) : recipes[0][0]
  );
  const [name, setName] = useState("");
  const [questions, setQuestions] = useState("Name\nEmail");
  const [tone, setTone] = useState("workspace-default");
  const [quietHours, setQuietHours] = useState(true);
  const [frequencyCap, setFrequencyCap] = useState(3);
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const response = await fetch("/api/automations", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": await csrf() },
      body: JSON.stringify({
        name,
        recipe,
        requestId,
        configuration: {
          questions: questions
            .split("\n")
            .map((question) => question.trim())
            .filter(Boolean),
          tone,
          quietHours,
          frequencyCap
        }
      })
    });
    if (response.ok) {
      setName("");
      setCurrentStep(0);
      setRequestId(crypto.randomUUID());
      setBusy(false);
      router.refresh();
    } else {
      setBusy(false);
      setMessage(
        text(
          "Check the automation details and try again.",
          "Otomasyon ayrıntılarını kontrol edip yeniden deneyin.",
          "جزئیات اتوماسیون را بررسی و دوباره تلاش کنید."
        )
      );
    }
  }

  function next() {
    if (currentStep === 0 && name.trim().length < 2) {
      setMessage(
        text(
          "Add an automation name to continue.",
          "Devam etmek için otomasyon adı ekleyin.",
          "برای ادامه نام اتوماسیون را وارد کنید."
        )
      );
      return;
    }
    if (currentStep === 2 && !questions.trim()) {
      setMessage(
        text(
          "Add at least one customer question.",
          "En az bir müşteri sorusu ekleyin.",
          "حداقل یک پرسش مشتری اضافه کنید."
        )
      );
      return;
    }
    setMessage("");
    setCurrentStep((step) => Math.min(step + 1, steps.length - 1));
  }

  return (
    <section className="panel automation-builder" id="new">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            {text("Seven-step builder", "Yedi adımlı oluşturucu", "سازنده هفت‌مرحله‌ای")}
          </span>
          <h2>{t("automations.create")}</h2>
        </div>
        <span>{text("Sandbox safe", "Sandbox güvenli", "امن در Sandbox")}</span>
      </div>
      <ol
        className="wizard-rail"
        aria-label={text("Seven setup steps", "Yedi kurulum adımı", "هفت مرحله راه‌اندازی")}
      >
        {steps.map((step, index) => (
          <li
            className={index === currentStep ? "current" : index < currentStep ? "complete" : ""}
            key={step}
          >
            <button type="button" onClick={() => index <= currentStep && setCurrentStep(index)}>
              <span>{index < currentStep ? "✓" : index + 1}</span>
              {step}
            </button>
          </li>
        ))}
      </ol>
      <form className="wizard-form" onSubmit={create}>
        {currentStep === 0 ? (
          <div className="wizard-panel">
            <span className="eyebrow">01 · Basics</span>
            <label>
              {text("Automation name", "Otomasyon adı", "نام اتوماسیون")}
              <input
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={text(
                  "New lead collector",
                  "Yeni aday toplayıcı",
                  "جمع‌آوری سرنخ جدید"
                )}
                required
                minLength={2}
              />
            </label>
          </div>
        ) : null}
        {currentStep === 1 ? (
          <div className="wizard-panel">
            <span className="eyebrow">02 · Channel & trigger</span>
            <div className="recipe-grid">
              {recipes.map(([id]) => (
                <button
                  type="button"
                  aria-pressed={recipe === id}
                  onClick={() => setRecipe(id)}
                  key={id}
                >
                  <strong>{recipeLabel(id)}</strong>
                  <span>
                    {id === "WHATSAPP_INBOUND"
                      ? text(
                          "24-hour service-window policy",
                          "24 saatlik hizmet penceresi politikası",
                          "سیاست پنجره ۲۴ ساعته گفتگو"
                        )
                      : id === "WHATSAPP_CONSENTED_FOLLOWUP_REMINDER"
                        ? text(
                            "One approved template, only with explicit opt-in",
                            "Yalnızca açık onayla tek onaylı şablon",
                            "فقط یک الگوی تأییدشده با رضایت صریح"
                          )
                        : id === "CROSS_CHANNEL_AFTER_HOURS_ESCALATION"
                          ? text(
                              "Human review without unsolicited cross-channel contact",
                              "İstenmeyen çapraz kanal teması olmadan insan incelemesi",
                              "بررسی انسانی بدون تماس ناخواسته در کانال دیگر"
                            )
                          : text(
                              "User-initiated Instagram messaging",
                              "Kullanıcının başlattığı Instagram mesajlaşması",
                              "پیام‌رسانی اینستاگرام به ابتکار کاربر"
                            )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {currentStep === 2 ? (
          <div className="wizard-panel">
            <span className="eyebrow">03 · Questions</span>
            <label>
              {text(
                "Customer questions (one per line)",
                "Müşteri soruları (satır başına bir)",
                "پرسش‌های مشتری (هر خط یک پرسش)"
              )}
              <textarea
                value={questions}
                onChange={(event) => setQuestions(event.target.value)}
                rows={5}
                required
              />
            </label>
            <p>
              {text(
                "Required fields are asked one at a time and confirmed answers are not repeated.",
                "Zorunlu alanlar tek tek sorulur ve doğrulanan yanıtlar tekrarlanmaz.",
                "فیلدهای ضروری یکی‌یکی پرسیده می‌شوند و پاسخ تأییدشده تکرار نمی‌شود."
              )}
            </p>
          </div>
        ) : null}
        {currentStep === 3 ? (
          <div className="wizard-panel">
            <span className="eyebrow">04 · Business answers</span>
            <h3>
              {text("Approved facts only", "Yalnızca onaylı bilgiler", "فقط اطلاعات تأییدشده")}
            </h3>
            <p>
              {text(
                "Replies use workspace pricing and FAQs. Missing approved knowledge always routes to human review.",
                "Yanıtlar çalışma alanı fiyatlarını ve SSS'leri kullanır. Eksik onaylı bilgi her zaman insan incelemesine yönlenir.",
                "پاسخ‌ها فقط از قیمت‌ها و پرسش‌های تأییدشده استفاده می‌کنند. نبود اطلاعات همیشه به بررسی انسانی می‌رسد."
              )}
            </p>
            <Link href="/settings">
              {text(
                "Review pricing and FAQs",
                "Fiyat ve SSS'leri incele",
                "بررسی قیمت و پرسش‌های متداول"
              )}
            </Link>
          </div>
        ) : null}
        {currentStep === 4 ? (
          <div className="wizard-panel">
            <span className="eyebrow">05 · AI style</span>
            <label>
              {text("Response style", "Yanıt stili", "سبک پاسخ")}
              <select value={tone} onChange={(event) => setTone(event.target.value)}>
                <option value="workspace-default">
                  {text(
                    "Use workspace default",
                    "Çalışma alanı varsayılanını kullan",
                    "استفاده از تنظیم پیش‌فرض"
                  )}
                </option>
                <option value="friendly-short">
                  {text("Friendly and short", "Samimi ve kısa", "دوستانه و کوتاه")}
                </option>
                <option value="formal-medium">
                  {text("Formal and medium", "Resmî ve orta", "رسمی و متوسط")}
                </option>
              </select>
            </label>
            <p>
              {text(
                "Low confidence and invalid structured output stop for human review.",
                "Düşük güven ve geçersiz yapılandırılmış çıktı insan incelemesinde durur.",
                "اطمینان پایین یا خروجی نامعتبر برای بررسی انسانی متوقف می‌شود."
              )}
            </p>
          </div>
        ) : null}
        {currentStep === 5 ? (
          <div className="wizard-panel">
            <span className="eyebrow">06 · Rules</span>
            <label className="check">
              <input
                type="checkbox"
                checked={quietHours}
                onChange={(event) => setQuietHours(event.target.checked)}
              />
              {text(
                "Respect workspace quiet hours",
                "Çalışma alanı sessiz saatlerine uy",
                "رعایت ساعت سکوت فضای کاری"
              )}
            </label>
            <label>
              {text(
                "Maximum automated sends per conversation",
                "Konuşma başına en fazla otomatik gönderim",
                "حداکثر ارسال خودکار در هر گفتگو"
              )}
              <input
                type="number"
                min={1}
                max={20}
                value={frequencyCap}
                onChange={(event) => setFrequencyCap(Number(event.target.value))}
              />
            </label>
          </div>
        ) : null}
        {currentStep === 6 ? (
          <div className="wizard-panel wizard-review">
            <span className="eyebrow">07 · Test & activate</span>
            <h3>{name}</h3>
            <p>{recipeLabel(recipe)}</p>
            <ul>
              <li>
                {questions.split("\n").filter(Boolean).length}{" "}
                {text("configured questions", "yapılandırılmış soru", "پرسش تنظیم‌شده")}
              </li>
              <li>
                {text(
                  "Sandbox test required before activation",
                  "Etkinleştirmeden önce Sandbox testi gerekir",
                  "پیش از فعال‌سازی، آزمایش Sandbox لازم است"
                )}
              </li>
              <li>
                {text(
                  "Every outbound attempt passes the policy gate",
                  "Her gönderim denemesi politika kapısından geçer",
                  "هر تلاش ارسال از دروازه سیاست عبور می‌کند"
                )}
              </li>
            </ul>
          </div>
        ) : null}
        <div className="wizard-actions">
          <button
            className="button-muted"
            type="button"
            onClick={() => setCurrentStep((step) => Math.max(step - 1, 0))}
            disabled={currentStep === 0}
          >
            {t("common.back")}
          </button>
          {currentStep < steps.length - 1 ? (
            <button key="continue-action" type="button" onClick={next}>
              {t("common.next")}
            </button>
          ) : (
            <button key="create-action" type="submit" disabled={busy}>
              {busy
                ? text("Creating…", "Oluşturuluyor…", "در حال ساخت…")
                : text("Create draft", "Taslak oluştur", "ساخت پیش‌نویس")}
            </button>
          )}
        </div>
      </form>
      {message && <p role="alert">{message}</p>}
    </section>
  );
}

export function AutomationActions({ id, status }: { id: string; status: string }) {
  const { text } = useI18n();
  const [message, setMessage] = useState("");
  const [currentStatus, setCurrentStatus] = useState(status);

  async function run(action: string) {
    const response = await fetch(`/api/automations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-csrf-token": await csrf() },
      body: JSON.stringify({ action })
    });
    setMessage(response.ok ? `${action.replace("_", " ")} completed.` : "Action failed.");
    if (response.ok) {
      setCurrentStatus(
        action === "activate"
          ? "ACTIVE"
          : action === "safe_test"
            ? "READY"
            : action === "pause" || action === "stop_queued"
              ? "PAUSED"
              : currentStatus
      );
    }
  }

  return (
    <div className="automation-actions">
      <button onClick={() => run(currentStatus === "ACTIVE" ? "pause" : "activate")}>
        {currentStatus === "ACTIVE"
          ? text("Pause now", "Şimdi duraklat", "توقف فوری")
          : text("Activate", "Etkinleştir", "فعال‌سازی")}
      </button>
      <button onClick={() => run("safe_test")}>
        {text("Run safe test", "Güvenli test çalıştır", "اجرای آزمایش امن")}
      </button>
      <button onClick={() => run("stop_queued")} className="button-muted">
        {text("Stop queued messages", "Kuyruktaki mesajları durdur", "توقف پیام‌های صف")}
      </button>
      <span className="status-pill">Current status: {currentStatus}</span>
      {message && <span role="status">{message}</span>}
    </div>
  );
}
