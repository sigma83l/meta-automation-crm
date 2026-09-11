"use client";

import { useState } from "react";
import { useI18n } from "@/src/lib/i18n/client";
import { isReviewReason } from "@/src/modules/rcos/review-reasons";
import { useHydrated } from "@/src/lib/react/use-hydrated";
import type {
  SimulationModelCall,
  SimulationTrace
} from "@/src/modules/automations/simulation-contracts";

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
  /**
   * The exchange so far, and what each answer cost.
   *
   * Held here rather than fetched, because the run writes nothing: a synthetic
   * conversation that persisted would put invented messages in a real inbox.
   * It is sent back with each message so the model can see what was already
   * said, which is what makes this a conversation rather than a series of
   * unrelated first contacts.
   */
  const [turns, setTurns] = useState<
    readonly Readonly<{ customer: string; trace?: SimulationTrace; error?: string }>[]
  >([]);

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
    const said = message.trim();
    if (!automationId || said.length === 0) return;
    setBusy(true);
    setError("");
    // Cleared straight away, the way a chat box empties when you press send.
    setMessage("");
    // Only what the assistant actually said goes back as history. A draft the
    // validator refused was never sent, so treating it as something the
    // business said would have the model answer a message its customer never
    // received.
    const history = turns.flatMap((turn) =>
      turn.trace?.wouldSend
        ? [
            { role: "customer" as const, content: turn.customer },
            { role: "business" as const, content: turn.trace.wouldSend.text }
          ]
        : [{ role: "customer" as const, content: turn.customer }]
    );
    try {
      const response = await fetch("/api/automations/test-center", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": await csrf() },
        body: JSON.stringify({
          automationId,
          channel,
          message: said,
          history,
          ...(conversationId ? { conversationId } : {})
        })
      });
      const body = (await response.json()) as SimulationTrace | { error: string };
      if (!response.ok || "error" in body) {
        setTurns((previous) => [
          ...previous,
          { customer: said, error: failureText("error" in body ? body.error : "SIMULATION_FAILED") }
        ]);
        return;
      }
      setTurns((previous) => [...previous, { customer: said, trace: body }]);
    } catch {
      setTurns((previous) => [
        ...previous,
        { customer: said, error: failureText("SIMULATION_FAILED") }
      ]);
    } finally {
      setBusy(false);
    }
  }

  /**
   * What an empty draft actually meant.
   *
   * Five causes collapse into `empty_draft` and the dictionary's sentence names
   * only the most common one. When a call record says which it was, that beats
   * a guess -- particularly for the case the sentence gets backwards, where the
   * model answered perfectly well and asked for a person.
   */
  const emptyDraftCause = (calls: readonly SimulationModelCall[]) => {
    // `task`, not `role`. This matched `role === "customer_reply"`, which is a
    // routing task and has never been a role, so the branch was dead and every
    // lookup fell through to the last call - right by accident while the reply
    // was always last, and wrong the moment anything is recorded after it.
    const reply = calls.find((call) => call.task === "reply") ?? calls.at(-1);
    if (!reply) return undefined;
    if (reply.deferredToHuman) {
      if (reply.deferralReason) {
        return `${text("The model asked for a person", "Model bir kişi istedi", "مدل درخواست انسان کرد")}: ${reply.deferralReason}`;
      }
      return text(
        "The model answered and asked for a person. That is a judgement, not a failure - usually low confidence or nothing approved to cite.",
        "Model yanıt verdi ve bir kişi istedi. Bu bir başarısızlık değil, bir karardır - genellikle düşük güven veya alıntılanacak onaylı bilgi yok.",
        "مدل پاسخ داد و درخواست انسان کرد. این یک قضاوت است نه خطا - معمولاً اطمینان پایین یا نبود دانش تأییدشده."
      );
    }
    if (reply.outcome === "failed") {
      return `${text("The provider refused the call", "Sağlayıcı çağrıyı reddetti", "ارائه‌دهنده تماس را رد کرد")}: ${reply.failureCode ?? "?"}${reply.failureKind ? ` (${reply.failureKind})` : ""}.`;
    }
    if (reply.outcome === "skipped") {
      return `${text("No call was made", "Çağrı yapılmadı", "تماسی انجام نشد")}: ${reply.failureCode ?? "?"}.`;
    }
    return undefined;
  };

  /**
   * The router's reasons, in the operator's language.
   *
   * Translated rather than shown raw because the codes are written for a log
   * and the person reading this screen is deciding whether to switch an
   * automation on. An unknown code falls through to itself: a reason nobody
   * translated is still better shown than swallowed.
   */
  const routingReason = (code: string) =>
    ({
      direct_lookup_against_approved_knowledge: text(
        "a direct lookup in approved knowledge",
        "onaylı bilgide doğrudan arama",
        "جست‌وجوی مستقیم در دانش تأییدشده"
      ),
      answer_already_known: text(
        "the answer was already known",
        "yanıt zaten biliniyordu",
        "پاسخ از پیش معلوم بود"
      ),
      high_stakes: text("the turn carries stakes", "bu tur riskli", "این نوبت حساس است"),
      confidence_below_escalation_threshold: text(
        "confidence too low for the stakes",
        "risk için güven çok düşük",
        "اطمینان برای این حساسیت کم است"
      ),
      confidence_below_lookup_floor: text(
        "confidence below the lookup floor",
        "güven arama eşiğinin altında",
        "اطمینان کمتر از آستانه جست‌وجو"
      ),
      nothing_approved_to_read: text(
        "nothing approved to read from",
        "okunacak onaylı bilgi yok",
        "دانش تأییدشده‌ای برای خواندن نبود"
      ),
      too_many_approved_items_to_choose_between: text(
        "too many approved items to choose between",
        "aralarından seçilecek çok fazla onaylı öğe",
        "موارد تأییدشده برای انتخاب بیش از حد است"
      ),
      context_too_large: text(
        "the prompt is too large for a lookup",
        "istem bir arama için çok büyük",
        "درخواست برای یک جست‌وجو بزرگ است"
      ),
      conversation_too_long_to_be_a_direct_question: text(
        "the conversation is past a direct question",
        "görüşme doğrudan bir soruyu aştı",
        "گفت‌وگو از یک پرسش مستقیم گذشته است"
      ),
      prior_turn_needed_a_person: text(
        "an earlier turn needed a person",
        "önceki bir tur kişi gerektirdi",
        "نوبت پیشین به انسان نیاز داشت"
      )
    })[code] ?? code;

  /**
   * What the run would have cost, in tokens.
   *
   * Tokens rather than money: the price of a model is configuration this code
   * deliberately does not know, and a currency figure derived from a rate
   * hard-coded here would be wrong the first time a vendor repriced. Output
   * includes reasoning tokens, which are billed as output and are most of what
   * a thinking model spends.
   */
  const tokenTotals = (calls: readonly SimulationModelCall[]) => {
    const counted = calls.filter((call) => call.inputTokens !== undefined);
    if (counted.length === 0) return undefined;
    return {
      input: counted.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0),
      output: counted.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0)
    };
  };

  const verdictLabel = (verdict: SimulationTrace["verdict"]) =>
    verdict === "would_send"
      ? text("WOULD SEND", "GÖNDERİLİRDİ", "ارسال می‌شد")
      : verdict === "would_hand_off"
        ? text("WOULD HAND OFF", "DEVREDİLİRDİ", "به انسان واگذار می‌شد")
        : text("WOULD BLOCK", "ENGELLENİRDİ", "مسدود می‌شد");

  /**
   * What the business bubble says.
   *
   * `??` is wrong for this and was the bug: a turn the model deferred returns
   * `text: ""` from `composedFrom`, and an empty string is not nullish, so it
   * passed through and rendered an empty bubble. A blank reply is the one
   * outcome that most needs words.
   *
   * When there is nothing to show, the reason codes say why in the customer's
   * own language, which is the same vocabulary the inbox uses for a flagged
   * conversation.
   */
  function spokenText(trace: SimulationTrace): string {
    const sent = trace.wouldSend?.text?.trim();
    if (sent) return sent;
    const drafted = trace.draft?.text?.trim();
    if (drafted) return drafted;

    const explained = trace.reasonCodes
      .filter((code) => isReviewReason(code))
      .map((code) =>
        code === "empty_draft"
          ? (emptyDraftCause(trace.modelCalls) ?? t(`review.${code}`))
          : t(`review.${code}`)
      );
    if (explained.length > 0) return explained.join(" ");
    return text(
      "No reply was produced, and a person would take this conversation.",
      "Yanıt üretilmedi; bu görüşmeyi bir kişi devralır.",
      "پاسخی تولید نشد؛ یک نفر این گفت‌وگو را برعهده می‌گیرد."
    );
  }

  /** One answered message: its verdict, its twelve steps, and what it cost. */
  function renderTrace(trace: SimulationTrace) {
    return (
      <div className="simulation-result">
        <div className={`simulation-verdict verdict-${trace.verdict}`}>
          <span className="eyebrow">{text("Verdict", "Karar", "حکم")}</span>
          <strong>{verdictLabel(trace.verdict)}</strong>
          {trace.reasonCodes.length > 0 && (
            <ul className="reason-codes">
              {trace.reasonCodes.map((code) => (
                <li key={code}>
                  <code>{code}</code>
                  {isReviewReason(code) && (
                    <span>
                      {code === "empty_draft" && emptyDraftCause(trace.modelCalls)
                        ? emptyDraftCause(trace.modelCalls)
                        : t(`review.${code}`)}
                    </span>
                  )}
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
        {trace.validationDetail && trace.validationDetail.length > 0 && (
          <ul className="validation-detail">
            {trace.validationDetail.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {trace.modelCalls.length > 0 && (
          <div className="model-calls">
            <span className="eyebrow">
              {text("Model calls", "Model çağrıları", "تماس‌های مدل")}
            </span>
            <ul>
              {trace.modelCalls.map((call, index) => (
                <li key={`${call.task}-${index}`} className={`call-${call.outcome}`}>
                  <code>
                    {call.task === "reply"
                      ? text("reply", "yanıt", "پاسخ")
                      : text("classify", "sınıflandırma", "دسته‌بندی")}
                    {" · "}
                    {call.role}
                  </code>
                  <span dir="ltr">{call.model || "—"}</span>
                  {/* Named rather than relying on being the last span: the
                      routing sentence below now takes that position, and the
                      status was aligned by `span:last-child`. */}
                  <span className="call-status">
                    {call.outcome}
                    {call.deferredToHuman
                      ? ` · ${text("asked for a person", "kişi istedi", "درخواست انسان")}`
                      : ""}
                    {call.failureCode ? ` · ${call.failureCode}` : ""}
                    {call.failureKind ? ` (${call.failureKind})` : ""}
                    {call.inputTokens === undefined
                      ? ""
                      : ` · ${call.inputTokens} ${text("in", "giriş", "ورودی")} / ${call.outputTokens} ${text("out", "çıkış", "خروجی")}`}
                  </span>
                  {/* Why this model and not a dearer one, which is the
                      question a dynamically routed reply raises and the
                      trace could not previously answer. */}
                  {call.routingReasons && call.routingReasons.length > 0 && (
                    <span className="routing-reasons">
                      {text("Chosen because", "Seçilme nedeni", "دلیل انتخاب")}:{" "}
                      {call.routingReasons.map(routingReason).join("; ")}
                    </span>
                  )}
                  {call.deferralReason && (
                    <span className="deferral-reason">{call.deferralReason}</span>
                  )}
                </li>
              ))}
            </ul>
            {(() => {
              const totals = tokenTotals(trace.modelCalls);
              return totals ? (
                <p className="token-totals">
                  {text("This turn", "Bu tur", "این نوبت")}: {totals.input}{" "}
                  {text("input tokens", "giriş jetonu", "توکن ورودی")}, {totals.output}{" "}
                  {text(
                    "output tokens including reasoning",
                    "akıl yürütme dahil çıkış jetonu",
                    "توکن خروجی شامل استدلال"
                  )}
                  .
                </p>
              ) : null;
            })()}
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
    );
  }

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
            ? text("Sending…", "Gönderiliyor…", "در حال ارسال…")
            : text("Send", "Gönder", "ارسال")}
        </button>
        {turns.length > 0 && (
          <button
            type="button"
            className="button-muted"
            disabled={!ready || busy}
            onClick={() => setTurns([])}
          >
            {text("New conversation", "Yeni görüşme", "گفت‌وگوی جدید")}
          </button>
        )}
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
      {turns.length > 0 && (
        <ol className="simulation-thread">
          {turns.map((turn, index) => (
            <li key={index}>
              <p className="thread-bubble from-customer" dir="auto">
                {turn.customer}
              </p>
              {turn.error ? (
                <p role="alert">{turn.error}</p>
              ) : turn.trace ? (
                <>
                  <p
                    className={`thread-bubble from-business verdict-${turn.trace.verdict}`}
                    dir="auto"
                  >
                    {spokenText(turn.trace)}
                  </p>
                  <details className="thread-trace">
                    <summary>
                      {verdictLabel(turn.trace.verdict)}
                      {turn.trace.modelCalls
                        .filter((call) => call.task === "reply")
                        .map((call) => ` · ${call.model}`)
                        .join("")}
                    </summary>
                    {renderTrace(turn.trace)}
                  </details>
                </>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
