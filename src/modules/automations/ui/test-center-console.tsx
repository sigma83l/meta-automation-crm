"use client";

import { useState } from "react";
import { useI18n } from "@/src/lib/i18n/client";
import { isReviewReason } from "@/src/modules/rcos/review-reasons";
import { useHydrated } from "@/src/lib/react/use-hydrated";
import type { SimulationTrace } from "@/src/modules/automations/simulation-contracts";

async function csrf() {
  return ((await fetch("/api/auth/csrf").then((response) => response.json())) as { token: string })
    .token;
}

export type TestCenterAutomation = Readonly<{
  id: string;
  name: string;
  recipe: string;
  status: string;
}>;

export type TestCenterConversation = Readonly<{ id: string; label: string }>;

const STATUS_TONE: Record<SimulationTrace["steps"][number]["status"], string> = {
  ran: "step-ran",
  blocked: "step-blocked",
  skipped: "step-skipped",
  stipulated: "step-stipulated"
};

export function TestCenterConsole({
  automations,
  conversations
}: {
  automations: readonly TestCenterAutomation[];
  conversations: readonly TestCenterConversation[];
}) {
  const { t, text } = useI18n();
  /** The run button is onClick-only, so it stays inert until hydration. */
  const ready = useHydrated();
  const [automationId, setAutomationId] = useState(automations[0]?.id ?? "");
  const [channel, setChannel] = useState<"whatsapp" | "instagram">("whatsapp");
  const [conversationId, setConversationId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [trace, setTrace] = useState<SimulationTrace | undefined>();

  const failureText = (code: string) =>
    code === "NO_BUSINESS_PROFILE"
      ? text(
          "This workspace has no business profile yet. Finish onboarding before testing.",
          "Bu çalışma alanında henüz işletme profili yok. Test etmeden önce kurulumu tamamlayın.",
          "این فضای کاری هنوز نمایه کسب‌وکار ندارد. پیش از آزمون، راه‌اندازی را کامل کنید."
        )
      : code === "AUTOMATION_NOT_FOUND"
        ? text(
            "That automation no longer exists.",
            "Bu otomasyon artık mevcut değil.",
            "این اتوماسیون دیگر وجود ندارد."
          )
        : text(
            "The simulation could not be completed.",
            "Simülasyon tamamlanamadı.",
            "شبیه‌سازی تکمیل نشد."
          );

  async function run() {
    if (!automationId || message.trim().length === 0) return;
    setBusy(true);
    setError("");
    setTrace(undefined);
    try {
      const response = await fetch("/api/automations/test-center", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": await csrf() },
        body: JSON.stringify({
          automationId,
          channel,
          message: message.trim(),
          ...(conversationId ? { conversationId } : {})
        })
      });
      const body = (await response.json()) as SimulationTrace | { error: string };
      if (!response.ok || "error" in body) {
        setError(failureText("error" in body ? body.error : "SIMULATION_FAILED"));
        return;
      }
      setTrace(body);
    } catch {
      setError(failureText("SIMULATION_FAILED"));
    } finally {
      setBusy(false);
    }
  }

  const verdictLabel = (verdict: SimulationTrace["verdict"]) =>
    verdict === "would_send"
      ? text("WOULD SEND", "GÖNDERİLİRDİ", "ارسال می‌شد")
      : verdict === "would_hand_off"
        ? text("WOULD HAND OFF", "DEVREDİLİRDİ", "به انسان واگذار می‌شد")
        : text("WOULD BLOCK", "ENGELLENİRDİ", "مسدود می‌شد");

  return (
    <section className="panel simulation-runner">
      <div className="simulation-controls">
        <label>
          <span>{text("Automation", "Otomasyon", "اتوماسیون")}</span>
          <select
            value={automationId}
            onChange={(event) => setAutomationId(event.target.value)}
            disabled={automations.length === 0}
          >
            {automations.map((automation) => (
              <option key={automation.id} value={automation.id}>
                {automation.name} · {automation.status}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{text("Channel", "Kanal", "کانال")}</span>
          <select
            value={channel}
            onChange={(event) => setChannel(event.target.value as "whatsapp" | "instagram")}
          >
            <option value="whatsapp">WhatsApp</option>
            <option value="instagram">Instagram</option>
          </select>
        </label>
        <label>
          <span>{text("Conversation", "Görüşme", "گفت‌وگو")}</span>
          <select
            value={conversationId}
            onChange={(event) => setConversationId(event.target.value)}
          >
            <option value="">
              {text(
                "Synthetic — no real conversation",
                "Sentetik — gerçek görüşme yok",
                "ساختگی — بدون گفت‌وگوی واقعی"
              )}
            </option>
            {conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>
                {conversation.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="simulation-input">
        <span>{text("Synthetic input", "Sentetik girdi", "ورودی ساختگی")}</span>
        <textarea
          dir="auto"
          rows={3}
          value={message}
          maxLength={4000}
          placeholder={text(
            "What is the approved price and when are you open?",
            "Onaylı fiyat nedir ve ne zaman açıksınız?",
            "قیمت تأییدشده چیست و چه ساعتی باز هستید؟"
          )}
          onChange={(event) => setMessage(event.target.value)}
        />
      </label>
      <div className="simulation-actions">
        <button
          type="button"
          disabled={!ready || busy || !automationId || message.trim().length === 0}
          onClick={run}
        >
          {busy
            ? text("Running…", "Çalışıyor…", "در حال اجرا…")
            : text("Run simulation", "Simülasyonu çalıştır", "اجرای شبیه‌سازی")}
        </button>
        <span className="status-pill">
          {text(
            "Nothing is sent or stored",
            "Hiçbir şey gönderilmez veya saklanmaz",
            "چیزی ارسال یا ذخیره نمی‌شود"
          )}
        </span>
      </div>
      {automations.length === 0 && (
        <p role="status">
          {text(
            "Create an automation first, then run its safe test here.",
            "Önce bir otomasyon oluşturun, sonra güvenli testini burada çalıştırın.",
            "ابتدا یک اتوماسیون بسازید، سپس آزمون امن آن را اینجا اجرا کنید."
          )}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {trace && (
        <div className="simulation-result">
          <div className={`simulation-verdict verdict-${trace.verdict}`}>
            <span className="eyebrow">{text("Verdict", "Karar", "حکم")}</span>
            <strong>{verdictLabel(trace.verdict)}</strong>
            {trace.reasonCodes.length > 0 && (
              <ul className="reason-codes">
                {trace.reasonCodes.map((code) => (
                  <li key={code}>
                    <code>{code}</code>
                    {isReviewReason(code) && <span>{t(`review.${code}`)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <ol className="simulation-steps">
            {trace.steps.map((step) => (
              <li key={step.id} className={STATUS_TONE[step.status]}>
                <span className="step-number">{step.step}</span>
                <span className="step-label">{step.label}</span>
                <span className="step-detail">{step.detail}</span>
              </li>
            ))}
          </ol>
          {trace.draft && (
            <div className="simulation-draft">
              <span className="eyebrow">
                {trace.wouldSend
                  ? text("Reply that would go out", "Gönderilecek yanıt", "پاسخی که ارسال می‌شد")
                  : text(
                      "Draft the validator refused",
                      "Doğrulayıcının reddettiği taslak",
                      "پیش‌نویسی که اعتبارسنج رد کرد"
                    )}
              </span>
              <p dir="auto">{trace.draft.text}</p>
              {trace.draft.citedRefs.length > 0 && (
                <p className="cited-refs">
                  {text("Cited", "Alıntılanan", "استناد")}: {trace.draft.citedRefs.join(", ")}
                </p>
              )}
            </div>
          )}
          {trace.subject === "synthetic" && (
            <p className="simulation-caveat" role="note">
              {text(
                "Step 4 used a stipulated open conversation. Entitlement, platform switch and feature flags were read live.",
                "4. adım varsayılan açık bir görüşme kullandı. Hak sahipliği, platform anahtarı ve özellik bayrakları canlı okundu.",
                "گام ۴ از یک گفت‌وگوی بازِ فرضی استفاده کرد. اشتراک، کلید پلتفرم و پرچم‌های ویژگی به‌صورت زنده خوانده شدند."
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
