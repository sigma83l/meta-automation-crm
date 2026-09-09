"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";

import { useI18n } from "@/src/lib/i18n/client";
import type { TranslationKey } from "@/src/lib/i18n/dictionaries";
import { useHydrated } from "@/src/lib/react/use-hydrated";
import {
  CLOSED,
  cannotAnswerCustomers,
  dayHours,
  defaultsFor,
  handoverLevels,
  hasOpenDay,
  hoursKey,
  needsOwnKey,
  openingHoursFaq,
  readStage,
  serialiseDay,
  setupAiModes,
  setupCurrencies,
  setupLanguages,
  setupStages,
  suggestedForbidden,
  suggestedTriggers,
  suggestionsFor,
  validateStage,
  weekdayLabel,
  weekdays,
  type HandoverLevel,
  type SetupDraft,
  type SetupIssue,
  type SetupIssues,
  type SetupStage,
  type SetupValue,
  type Weekday
} from "@/src/modules/workspaces/onboarding/setup-plan";
import { PreferenceControls } from "@/src/modules/workspaces/ui/preference-controls";

/**
 * The six things a workspace has to say before its assistant can answer
 * anybody, in the order a shop owner can answer them.
 *
 * It was eight, and three of them wrote nothing: a public name and description
 * that duplicated the workspace name, a recipe picker that created no
 * automation, and a "synthetic test input" box that was never read. Two more
 * asked for a support contact, a service region and social links that no
 * column stores. What is left is ordered by what it unlocks rather than by
 * topic - hours first because they are the one answer every shop already knows
 * and the first the assistant can give.
 */
const stageCopy: Readonly<Record<SetupStage, readonly [TranslationKey, TranslationKey]>> = {
  welcome: ["onboarding.stage.welcome", "onboarding.stage.welcome.detail"],
  hours: ["onboarding.stage.hours", "onboarding.stage.hours.detail"],
  knowledge: ["onboarding.stage.knowledge", "onboarding.stage.knowledge.detail"],
  limits: ["onboarding.stage.limits", "onboarding.stage.limits.detail"],
  assistant: ["onboarding.stage.assistant", "onboarding.stage.assistant.detail"],
  connect: ["onboarding.stage.connect", "onboarding.stage.connect.detail"]
};

const FALLBACK_TIMEZONE = "Europe/Istanbul";
const COMMON_TIMEZONES = [
  "Europe/Istanbul",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tehran",
  "Asia/Dubai",
  "America/New_York",
  "UTC"
] as const;

/**
 * Language names in their own language, as `PreferenceControls` already writes
 * them. Not `Intl.DisplayNames`: this list is rendered on the server and again
 * in the browser, and an endonym is also the name the person choosing it reads
 * most easily.
 */
const languageNames: Readonly<Record<(typeof setupLanguages)[number], string>> = {
  tr: "Türkçe",
  en: "English",
  fa: "فارسی",
  ar: "العربية",
  de: "Deutsch",
  fr: "Français",
  ru: "Русский",
  es: "Español"
};

type Draft = Record<string, SetupValue>;

async function csrf() {
  return ((await fetch("/api/auth/csrf").then((response) => response.json())) as { token: string })
    .token;
}

function Field({
  name,
  label,
  value,
  onChange,
  onBlur,
  type = "text",
  hint,
  placeholder,
  issue,
  wide = false,
  listId
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  type?: "text" | "number" | "textarea";
  hint?: string | undefined;
  placeholder?: string | undefined;
  issue?: string | undefined;
  wide?: boolean;
  listId?: string | undefined;
}) {
  const id = useId();
  // Both are named whether or not they render, so the input's description does
  // not change identity when an error appears and disappears.
  const described = `${id}-hint ${id}-issue`;
  const shared = {
    id,
    name,
    onBlur,
    placeholder,
    "aria-describedby": described,
    "aria-invalid": issue ? (true as const) : undefined
  };
  return (
    <div className={wide ? "setup-field wide" : "setup-field"}>
      <label htmlFor={id}>{label}</label>
      {type === "textarea" ? (
        <textarea {...shared} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input
          {...shared}
          type={type}
          inputMode={type === "number" ? "decimal" : undefined}
          list={listId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <p className="setup-hint" id={`${id}-hint`}>
        {hint}
      </p>
      <p className="setup-issue" id={`${id}-issue`}>
        {issue}
      </p>
    </div>
  );
}

/**
 * A set of suggestions that can be unticked, plus anything the workspace adds.
 *
 * Suggestions rather than an empty box because the empty box is what produced
 * an escalation keyword of "uyjgefu": asked to invent terms for a mechanism
 * they have not seen yet, people type something to get past the field. A
 * custom entry joins the same list as a ticked box, so removing it is the same
 * gesture as declining a suggestion and there is no second control to learn.
 */
function ChoiceList({
  legend,
  hint,
  suggestions,
  selected,
  onChange,
  addLabel,
  addPlaceholder,
  issue
}: {
  legend: string;
  hint: string;
  suggestions: readonly string[];
  selected: readonly string[];
  onChange: (next: readonly string[]) => void;
  addLabel: string;
  addPlaceholder: string;
  issue?: string | undefined;
}) {
  const id = useId();
  const [pending, setPending] = useState("");
  const options = useMemo(
    () => [...suggestions, ...selected.filter((entry) => !suggestions.includes(entry))],
    [suggestions, selected]
  );

  function add() {
    const entry = pending.trim();
    if (!entry || selected.includes(entry)) return setPending("");
    onChange([...selected, entry]);
    setPending("");
  }

  return (
    <fieldset className="setup-choices wide" aria-describedby={`${id}-hint ${id}-issue`}>
      <legend>{legend}</legend>
      <p className="setup-hint" id={`${id}-hint`}>
        {hint}
      </p>
      <ul>
        {options.map((option) => (
          <li key={option}>
            <label>
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, option]
                      : selected.filter((entry) => entry !== option)
                  )
                }
              />
              <span>{option}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="setup-choice-add">
        <label htmlFor={`${id}-add`}>{addLabel}</label>
        <input
          id={`${id}-add`}
          value={pending}
          placeholder={addPlaceholder}
          onChange={(event) => setPending(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            // The field sits in no form, so Enter would otherwise do nothing at
            // all and the typed entry would be lost on the next click.
            event.preventDefault();
            add();
          }}
        />
        <button type="button" className="button-muted" onClick={add}>
          +
        </button>
      </div>
      <p className="setup-issue" id={`${id}-issue`}>
        {issue}
      </p>
    </fieldset>
  );
}

export function OnboardingForm({
  initialStage,
  initialCompleted,
  initialSkipped,
  initialData,
  initialLastSavedAt
}: {
  initialStage: string;
  initialCompleted: readonly string[];
  initialSkipped: readonly string[];
  initialData: Readonly<Record<string, Draft>>;
  initialLastSavedAt?: string;
}) {
  const { locale, theme, t, text } = useI18n();
  const firstIncomplete = setupStages.findIndex(
    (id) => !initialCompleted.includes(id) && !initialSkipped.includes(id)
  );
  const restored = setupStages.findIndex((id) => id === initialStage);
  const restoredIsResolved =
    restored >= 0 &&
    (initialCompleted.includes(setupStages[restored] ?? "") ||
      initialSkipped.includes(setupStages[restored] ?? ""));
  const initialIndex =
    firstIncomplete >= 0 && (restored < 0 || restoredIsResolved)
      ? firstIncomplete
      : Math.max(restored, 0);
  const [index, setIndex] = useState(initialIndex);
  const [completed, setCompleted] = useState([...initialCompleted]);
  const [skipped, setSkipped] = useState([...initialSkipped]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({ ...initialData });
  const [status, setStatus] = useState("");
  const [issues, setIssues] = useState<SetupIssues>({});
  const [lastSavedAt, setLastSavedAt] = useState(initialLastSavedAt);
  const stage = setupStages[index] ?? "welcome";
  const ready = useHydrated();
  const fieldsRef = useRef<HTMLDivElement>(null);

  /**
   * The language the workspace answers customers in, which is not the language
   * this screen is in. Suggested handover terms and the generated opening-hours
   * answer both follow the customers, not the person setting things up.
   */
  const replyLanguage = String(drafts.welcome?.replyLanguage ?? locale);
  const timezone = String(drafts.hours?.timezone ?? FALLBACK_TIMEZONE);

  /**
   * The stage as it will be submitted: defaults underneath, typed values on
   * top. Rendering from the same object is what makes the defaults real - the
   * old form showed `0.75` and `PLATFORM_PAID_DEFAULT` as display fallbacks and
   * then posted a stage that contained neither, so pressing Continue without
   * touching anything stored nothing at all.
   */
  const draftFor = useMemo(() => {
    return (id: SetupStage): SetupDraft => ({
      ...defaultsFor(id, id === "welcome" ? locale : replyLanguage, timezone),
      ...(drafts[id] ?? {})
    });
  }, [drafts, locale, replyLanguage, timezone]);
  const draft = draftFor(stage);

  function value(name: string) {
    return String(draft[name] ?? "");
  }
  function chosen(name: string): readonly string[] {
    return listValue(draft, name);
  }

  function update(name: string, nextValue: SetupValue): SetupDraft {
    const next = { ...draftFor(stage), [name]: nextValue };
    setIssues((current) =>
      current[name]
        ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== name))
        : current
    );
    setDrafts((current) => ({ ...current, [stage]: next }));
    return next;
  }

  /**
   * Changes a control that has no meaningful blur - a select, a checkbox, a
   * radio - and saves it in the same gesture.
   *
   * The new draft is handed to `save` rather than read back out of state,
   * because `setDrafts` has not applied yet when this returns: calling save()
   * on its own here would post the value the control held before the click.
   */
  function commit(name: string, nextValue: SetupValue) {
    void save("save", false, update(name, nextValue));
  }

  const issueText = (issue?: SetupIssue) => {
    switch (issue) {
      case "required":
        return text("Fill this in first.", "Önce burayı doldurun.", "ابتدا این را کامل کنید.");
      case "tooShort":
        return text(
          "Too short to be useful to a customer.",
          "Bir müşteriye yararlı olamayacak kadar kısa.",
          "برای پاسخ به مشتری بسیار کوتاه است."
        );
      case "notAQuestion":
        return text(
          "Write it as a customer would ask it, ending in a question mark.",
          "Bir müşterinin soracağı gibi, soru işaretiyle bitirerek yazın.",
          "همان‌گونه بنویسید که مشتری می‌پرسد و با علامت سؤال تمام کنید."
        );
      case "notAnAmount":
        return text(
          "Enter the amount in numbers, above zero.",
          "Tutarı sıfırdan büyük bir sayı olarak girin.",
          "مبلغ را به عدد و بزرگ‌تر از صفر وارد کنید."
        );
      case "notATimezone":
        return text(
          "Unknown timezone. Pick one from the list.",
          "Bilinmeyen saat dilimi. Listeden birini seçin.",
          "منطقه زمانی ناشناخته است. یکی را از فهرست انتخاب کنید."
        );
      case "notAChoice":
        return text(
          "Pick one of the options.",
          "Seçeneklerden birini seçin.",
          "یکی از گزینه‌ها را انتخاب کنید."
        );
      case "noOpenDay":
        return text(
          "Open on at least one day, or the assistant can never say you are open.",
          "En az bir gün açık olun; aksi hâlde asistan açık olduğunuzu hiç söyleyemez.",
          "دست‌کم یک روز باز باشید، وگرنه دستیار هرگز نمی‌تواند بگوید باز هستید."
        );
      default:
        return undefined;
    }
  };

  /** Returns false when the step could not be saved, so callers can stop. */
  async function save(
    action: "save" | "complete" | "skip",
    move = false,
    override?: SetupDraft
  ): Promise<boolean> {
    const data = override ?? draftFor(stage);
    if (action === "complete") {
      // Checked here as well as on the server so a mistake is answered in the
      // field it was made in rather than by a failed request.
      const found = validateStage(stage, data);
      if (Object.keys(found).length > 0) {
        setIssues(found);
        setStatus(
          text(
            "Check the highlighted fields.",
            "İşaretli alanları kontrol edin.",
            "فیلدهای مشخص‌شده را بررسی کنید."
          )
        );
        return false;
      }
    }
    setStatus(t("common.saving"));
    const response = await fetch("/api/onboarding/progress", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-csrf-token": await csrf() },
      body: JSON.stringify({
        stage,
        action,
        data: stage === "welcome" ? { ...data, defaultLocale: locale, preferredTheme: theme } : data
      })
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        fields?: SetupIssues;
      };
      if (body.fields) {
        setIssues(body.fields);
        setStatus(
          text(
            "Check the highlighted fields.",
            "İşaretli alanları kontrol edin.",
            "فیلدهای مشخص‌شده را بررسی کنید."
          )
        );
        return false;
      }
      setStatus(
        text(
          "Save failed. Try again.",
          "Kayıt başarısız. Yeniden deneyin.",
          "ذخیره نشد. دوباره تلاش کنید."
        )
      );
      return false;
    }
    const result = (await response.json()) as {
      completed: string[];
      skipped: string[];
      lastSavedAt: string;
    };
    setIssues({});
    setCompleted(result.completed);
    setSkipped(result.skipped);
    setLastSavedAt(result.lastSavedAt);
    setStatus(t("common.saved"));
    if (move && index < setupStages.length - 1) setIndex(index + 1);
    return true;
  }

  /**
   * Saves, opens the account gate, and leaves for the dashboard.
   *
   * Both footer actions that leave this screen go through here, because both
   * have to do the same three things and only one of them used to.
   *
   * ## Why leaving has to open the gate
   *
   * `/dashboard` redirects to `/onboarding` while `onboarding_states`
   * .auth_completed_at is null, and the only thing that set it was Enter
   * Sandbox on the last stage. So Save and exit saved, navigated to
   * `/dashboard`, and was bounced straight back to the stage it came from:
   * there was no way out of setup short of walking every step, and the button
   * named itself after something it could not do. `signUp` in
   * `tests/e2e/support/workspace.ts` carried a retry loop and a networkidle
   * wait to survive that bounce, and `/admin`'s spec had to write
   * `auth_completed_at` through the service role because the product could
   * not.
   *
   * The gate is not "every stage is done" - the function behind it is
   * `complete_auth_onboarding` and the step it records is `auth-complete`. It
   * means the account is set up enough to use the application, which is
   * exactly what somebody pressing Save and exit is asserting. Nothing is lost
   * by honouring it: `current_step`, `completed_steps`, `skipped_steps` and
   * `stage_data` are all untouched, `/onboarding` has no redirect of its own
   * and rehydrates from that state, and the dashboard already carries the
   * Launch checklist marked Resumable. Every stage is skippable too, so a
   * person could always reach the dashboard with nothing configured - the old
   * behaviour did not protect the setup, it just made one button lie.
   */
  async function saveAndLeave() {
    // Every failure here used to be silent: a rejected save was ignored, a
    // failed completion produced no message, and a thrown request left the
    // button looking inert. The user saw a click that did nothing.
    try {
      if (!(await save("save"))) return;
      const response = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "x-csrf-token": await csrf() }
      });
      if (!response.ok) {
        setStatus(t("system.errorDetail"));
        return;
      }
      // A full navigation rather than router.push: finishing onboarding
      // changes what every server component renders, and a client-side push
      // can serve a cached RSC payload that still shows the setup state.
      window.location.assign("/dashboard");
    } catch {
      setStatus(t("system.errorDetail"));
    }
  }

  const blurSave = () => void save("save");

  // A message in the status region says something is wrong somewhere; moving
  // the caret to the field says where. Without it the person who pressed
  // Continue on the fourth stage has to hunt for which of nine controls
  // objected.
  const issueCount = Object.keys(issues).length;
  useEffect(() => {
    if (issueCount === 0) return;
    fieldsRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [issueCount]);

  // The day names on this screen follow the screen, not the customers: the
  // person reading them is the one setting the shop up.
  const dayName = (day: Weekday) => weekdayLabel(day, locale);

  const hoursDraft = draftFor("hours");
  const knowledgeDraft = draftFor("knowledge");
  const limitsDraft = draftFor("limits");
  const assistantDraft = draftFor("assistant");
  const hoursAnswer = openingHoursFaq(hoursDraft, replyLanguage);

  return (
    <section className="setup-program" aria-label={t("onboarding.progress")}>
      <aside className="setup-rail">
        <div
          className="setup-progress"
          role="progressbar"
          aria-label={t("onboarding.progress")}
          aria-valuenow={index + 1}
          aria-valuemin={1}
          aria-valuemax={setupStages.length}
        >
          <span style={{ inlineSize: `${((index + 1) / setupStages.length) * 100}%` }} />
        </div>
        <p className="setup-progress-label">
          {t("onboarding.progress")} · {index + 1}/{setupStages.length}
        </p>
        {/* The rail is one column per stage on narrow screens; the count is a
            fact about this array, so it travels with it rather than being
            repeated as a number in the stylesheet. */}
        <ol style={{ "--setup-stage-count": setupStages.length } as CSSProperties}>
          {setupStages.map((id, stageIndex) => (
            <li
              key={id}
              className={
                stageIndex === index
                  ? "current"
                  : completed.includes(id)
                    ? "complete"
                    : skipped.includes(id)
                      ? "skipped"
                      : ""
              }
            >
              <button
                type="button"
                disabled={!ready}
                aria-current={stageIndex === index ? "step" : undefined}
                onClick={() => setIndex(stageIndex)}
              >
                <span aria-hidden="true">{completed.includes(id) ? "✓" : stageIndex + 1}</span>
                {t(stageCopy[id][0])}
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <article className="setup-stage">
        <header>
          <div>
            <span className="eyebrow">
              {index + 1} / {setupStages.length}
            </span>
            <h2>{t(stageCopy[stage][0])}</h2>
            <p>{t(stageCopy[stage][1])}</p>
          </div>
          <PreferenceControls />
        </header>

        <div className="setup-fields" ref={fieldsRef}>
          {stage === "welcome" ? (
            <>
              <Field
                name="workspaceName"
                label={t("onboarding.workspaceName")}
                value={value("workspaceName")}
                placeholder={text("Deniz Coffee", "Deniz Kahve", "قهوه دنیز")}
                hint={text(
                  "The name customers know you by. It is what the assistant answers as.",
                  "Müşterilerin sizi tanıdığı ad. Asistan bu adla yanıt verir.",
                  "نامی که مشتریان با آن شما را می‌شناسند؛ دستیار با همین نام پاسخ می‌دهد."
                )}
                issue={issueText(issues.workspaceName)}
                onChange={(next) => update("workspaceName", next)}
                onBlur={blurSave}
              />
              <div className="setup-field">
                <label htmlFor="replyLanguage">{t("onboarding.replyLanguage")}</label>
                <select
                  id="replyLanguage"
                  name="replyLanguage"
                  value={value("replyLanguage")}
                  aria-describedby="replyLanguage-hint"
                  onChange={(event) => commit("replyLanguage", event.target.value)}
                >
                  {setupLanguages.map((code) => (
                    <option key={code} value={code}>
                      {languageNames[code]}
                    </option>
                  ))}
                </select>
                <p className="setup-hint" id="replyLanguage-hint">
                  {text(
                    "The language replies are written in. It is separate from the language of this screen, which you can change above.",
                    "Yanıtların yazılacağı dil. Yukarıdan değiştirebileceğiniz ekran dilinden ayrıdır.",
                    "زبانی که پاسخ‌ها با آن نوشته می‌شود؛ جدا از زبان این صفحه است که از بالا قابل تغییر است."
                  )}
                </p>
              </div>
            </>
          ) : null}

          {stage === "hours" ? (
            <>
              <Field
                name="timezone"
                label={t("onboarding.timezone")}
                value={value("timezone")}
                listId="setup-timezones"
                hint={text(
                  "Which clock the hours below are on.",
                  "Aşağıdaki saatlerin hangi saate göre olduğu.",
                  "ساعات زیر بر اساس کدام منطقه زمانی است."
                )}
                issue={issueText(issues.timezone)}
                onChange={(next) => update("timezone", next)}
                onBlur={blurSave}
              />
              <datalist id="setup-timezones">
                {COMMON_TIMEZONES.map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
              <fieldset className="setup-hours wide">
                <legend>{t("onboarding.hours")}</legend>
                <p className="setup-hint">
                  {text(
                    "A day left closed is still an answer: the assistant may say you are closed that day. A day nobody fills in is one it must refuse to discuss.",
                    "Kapalı bırakılan gün de bir yanıttır: asistan o gün kapalı olduğunuzu söyleyebilir. Hiç doldurulmayan gün ise konuşamayacağı bir gündür.",
                    "روزی که تعطیل بماند هم یک پاسخ است: دستیار می‌تواند بگوید آن روز تعطیل هستید. روزی که پر نشود، روزی است که اجازه صحبت درباره‌اش را ندارد."
                  )}
                </p>
                <ol>
                  {weekdays.map((day) => {
                    const hours = dayHours(hoursDraft, day);
                    return (
                      <li key={day}>
                        <label className="setup-hours-day">
                          <input
                            type="checkbox"
                            checked={hours.open}
                            onChange={(event) =>
                              commit(
                                hoursKey(day),
                                event.target.checked
                                  ? serialiseDay({ open: true, from: "09:00", to: "18:00" })
                                  : CLOSED
                              )
                            }
                          />
                          <span>{dayName(day)}</span>
                        </label>
                        {hours.open ? (
                          <span className="setup-hours-range">
                            <label>
                              <span className="sr-only">
                                {dayName(day)} · {text("opens", "açılış", "باز شدن")}
                              </span>
                              <input
                                type="time"
                                value={hours.from}
                                onChange={(event) =>
                                  update(hoursKey(day), `${event.target.value}-${hours.to}`)
                                }
                                onBlur={blurSave}
                              />
                            </label>
                            <span aria-hidden="true">–</span>
                            <label>
                              <span className="sr-only">
                                {dayName(day)} · {text("closes", "kapanış", "بسته شدن")}
                              </span>
                              <input
                                type="time"
                                value={hours.to}
                                onChange={(event) =>
                                  update(hoursKey(day), `${hours.from}-${event.target.value}`)
                                }
                                onBlur={blurSave}
                              />
                            </label>
                          </span>
                        ) : (
                          <span className="setup-hours-closed">
                            {text("Closed", "Kapalı", "تعطیل")}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
                <p className="setup-issue">{issueText(issues.days)}</p>
              </fieldset>
              <div className="setup-preview wide">
                <strong>
                  {text(
                    "Your assistant will be able to answer this",
                    "Asistanınız bu soruyu yanıtlayabilecek",
                    "دستیار شما می‌تواند به این پرسش پاسخ دهد"
                  )}
                </strong>
                <p>{hoursAnswer.question}</p>
                <pre>{hoursAnswer.answer}</pre>
                <span>
                  {text(
                    "Saved as an approved answer, because opening hours on their own are only a permission - the assistant is never shown them.",
                    "Onaylı yanıt olarak kaydedilir; çalışma saatleri tek başına yalnızca bir izindir, asistana hiç gösterilmez.",
                    "به‌عنوان پاسخ تأییدشده ذخیره می‌شود؛ ساعات کاری به‌تنهایی فقط یک مجوز است و هرگز به دستیار نشان داده نمی‌شود."
                  )}
                </span>
              </div>
            </>
          ) : null}

          {stage === "knowledge" ? (
            <>
              <Field
                name="faqQuestion"
                label={text(
                  "A question customers actually ask",
                  "Müşterilerin gerçekten sorduğu bir soru",
                  "پرسشی که مشتریان واقعاً می‌پرسند"
                )}
                value={value("faqQuestion")}
                placeholder={text(
                  "Do you deliver to the city centre?",
                  "Şehir merkezine teslimat yapıyor musunuz?",
                  "به مرکز شهر ارسال دارید؟"
                )}
                hint={text(
                  "In their words, not yours. The assistant matches what a customer writes against this.",
                  "Sizin değil, onların cümlesiyle. Asistan müşterinin yazdığını bununla eşleştirir.",
                  "با جمله‌ی آن‌ها، نه شما؛ دستیار پیام مشتری را با همین مقایسه می‌کند."
                )}
                issue={issueText(issues.faqQuestion)}
                onChange={(next) => update("faqQuestion", next)}
                onBlur={blurSave}
                wide
              />
              <Field
                name="faqAnswer"
                label={text(
                  "The answer it is allowed to give",
                  "Verebileceği onaylı yanıt",
                  "پاسخی که اجازه دارد بدهد"
                )}
                value={value("faqAnswer")}
                type="textarea"
                placeholder={text(
                  "Yes. We deliver to the city centre the same week, and delivery is free above 500 TL.",
                  "Evet. Şehir merkezine aynı hafta teslim ediyoruz, 500 TL üzeri teslimat ücretsizdir.",
                  "بله. در همان هفته به مرکز شهر ارسال می‌کنیم و ارسال بالای ۵۰۰ لیر رایگان است."
                )}
                hint={text(
                  "Write it as you would send it. Anything not written here, the assistant must hand to a person.",
                  "Göndereceğiniz gibi yazın. Burada yazmayan her şeyi asistan bir kişiye devretmek zorundadır.",
                  "همان‌گونه بنویسید که می‌فرستید. هر چیزی که اینجا نباشد باید به یک نفر واگذار شود."
                )}
                issue={issueText(issues.faqAnswer)}
                onChange={(next) => update("faqAnswer", next)}
                onBlur={blurSave}
                wide
              />
              <Field
                name="priceName"
                label={text(
                  "One thing you sell",
                  "Sattığınız bir şey",
                  "یکی از چیزهایی که می‌فروشید"
                )}
                value={value("priceName")}
                placeholder={text("Haircut", "Saç kesimi", "کوتاهی مو")}
                hint={text(
                  "A price the assistant may quote without asking you.",
                  "Asistanın size sormadan söyleyebileceği bir fiyat.",
                  "قیمتی که دستیار بدون پرسیدن از شما می‌تواند بگوید."
                )}
                issue={issueText(issues.priceName)}
                onChange={(next) => update("priceName", next)}
                onBlur={blurSave}
              />
              <Field
                name="priceAmount"
                label={text("Its price", "Fiyatı", "قیمت آن")}
                value={value("priceAmount")}
                type="number"
                placeholder="450"
                hint={text(
                  "Any other number is blocked before it reaches a customer.",
                  "Başka bir rakam müşteriye ulaşmadan engellenir.",
                  "هر عدد دیگری پیش از رسیدن به مشتری مسدود می‌شود."
                )}
                issue={issueText(issues.priceAmount)}
                onChange={(next) => update("priceAmount", next)}
                onBlur={blurSave}
              />
              <div className="setup-field">
                <label htmlFor="currency">{text("Currency", "Para birimi", "واحد پول")}</label>
                <select
                  id="currency"
                  name="currency"
                  value={value("currency")}
                  onChange={(event) => commit("currency", event.target.value)}
                >
                  {setupCurrencies.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
                <p className="setup-issue">{issueText(issues.currency)}</p>
              </div>
              <p className="setup-callout">
                {text(
                  "One of each is enough to start. Add the rest in Settings once you have seen how the first ones answer.",
                  "Başlangıç için birer tane yeterli. İlk yanıtları gördükten sonra kalanını Ayarlar'dan ekleyin.",
                  "برای شروع یکی از هرکدام کافی است. بقیه را پس از دیدن نخستین پاسخ‌ها در تنظیمات اضافه کنید."
                )}
              </p>
            </>
          ) : null}

          {stage === "limits" ? (
            <>
              <ChoiceList
                legend={t("onboarding.escalation")}
                hint={text(
                  "A message containing any of these goes straight to you, whatever else it says.",
                  "Bunlardan birini içeren mesaj, başka ne yazarsa yazsın doğrudan size gelir.",
                  "پیامی که هر یک از این‌ها را داشته باشد، مستقیم به شما می‌رسد."
                )}
                suggestions={suggestionsFor(suggestedTriggers, replyLanguage)}
                selected={chosen("escalationKeywords")}
                onChange={(next) => commit("escalationKeywords", next)}
                addLabel={text("Add your own", "Kendi kelimenizi ekleyin", "افزودن مورد دلخواه")}
                addPlaceholder={text("allergy", "alerji", "حساسیت")}
                issue={issueText(issues.escalationKeywords)}
              />
              <ChoiceList
                legend={t("onboarding.forbidden")}
                hint={text(
                  "Promises the assistant must never make, even if a customer asks for one.",
                  "Müşteri istese bile asistanın asla veremeyeceği sözler.",
                  "وعده‌هایی که دستیار هرگز نباید بدهد، حتی اگر مشتری بخواهد."
                )}
                suggestions={suggestionsFor(suggestedForbidden, replyLanguage)}
                selected={chosen("forbiddenClaims")}
                onChange={(next) => commit("forbiddenClaims", next)}
                addLabel={text("Add your own", "Kendi ifadenizi ekleyin", "افزودن مورد دلخواه")}
                addPlaceholder={text(
                  "we can beat any price",
                  "her fiyatı kırarız",
                  "هر قیمتی را می‌شکنیم"
                )}
                issue={issueText(issues.forbiddenClaims)}
              />
              <fieldset className="setup-choices wide">
                <legend>{t("onboarding.confidence")}</legend>
                <div className="setup-levels">
                  {(Object.keys(handoverLevels) as HandoverLevel[]).map((level) => (
                    <label key={level}>
                      <input
                        type="radio"
                        name="handover"
                        value={level}
                        checked={value("handover") === level}
                        onChange={() => commit("handover", level)}
                      />
                      <span>
                        {level === "often"
                          ? text(
                              "Whenever there is any doubt",
                              "En ufak şüphede",
                              "در کوچک‌ترین تردید"
                            )
                          : level === "balanced"
                            ? text("Balanced", "Dengeli", "متعادل")
                            : text(
                                "Only when it is really stuck",
                                "Yalnızca gerçekten takıldığında",
                                "فقط وقتی واقعاً درمانده شد"
                              )}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="setup-issue">{issueText(issues.handover)}</p>
              </fieldset>
            </>
          ) : null}

          {stage === "assistant" ? (
            <>
              <div className="setup-field wide">
                <label htmlFor="mode">{t("onboarding.aiMode")}</label>
                <select
                  id="mode"
                  name="mode"
                  value={value("mode")}
                  aria-describedby="mode-hint"
                  onChange={(event) => commit("mode", event.target.value)}
                >
                  {setupAiModes.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode === "PLATFORM_PAID_DEFAULT"
                        ? text(
                            "Included with your plan (recommended)",
                            "Planınıza dahil (önerilen)",
                            "همراه با اشتراک شما (پیشنهادی)"
                          )
                        : mode === "WORKSPACE_BYOK_OPENAI"
                          ? text("My own OpenAI key", "Kendi OpenAI anahtarım", "کلید OpenAI خودم")
                          : text(
                              "Demo — will not answer real customers",
                              "Demo — gerçek müşterilere yanıt vermez",
                              "نمایشی — به مشتریان واقعی پاسخ نمی‌دهد"
                            )}
                    </option>
                  ))}
                </select>
                <p className="setup-hint" id="mode-hint">
                  {text(
                    "Who pays for the model that writes the drafts. Nothing is sent to a customer without passing the same checks either way.",
                    "Taslakları yazan modelin bedelini kimin ödediği. Hangisi olursa olsun hiçbir mesaj aynı denetimlerden geçmeden gönderilmez.",
                    "هزینه‌ی مدلی که پیش‌نویس‌ها را می‌نویسد بر عهده‌ی کیست. در هر حالت هیچ پیامی بدون گذر از همان بررسی‌ها ارسال نمی‌شود."
                  )}
                </p>
                <p className="setup-issue">{issueText(issues.mode)}</p>
              </div>
              {cannotAnswerCustomers(value("mode")) ? (
                <p className="setup-callout danger wide" role="alert">
                  {text(
                    "In Demo the assistant is given no model for real conversations, so every incoming message is handed to a person and no customer gets a reply. Choose it only to look around.",
                    "Demo modunda asistana gerçek konuşmalar için model verilmez; gelen her mesaj bir kişiye devredilir ve hiçbir müşteri yanıt almaz. Yalnızca incelemek için seçin.",
                    "در حالت نمایشی هیچ مدلی برای گفتگوی واقعی در اختیار دستیار نیست؛ هر پیام به یک نفر واگذار می‌شود و مشتری پاسخی نمی‌گیرد. فقط برای مرور انتخابش کنید."
                  )}
                </p>
              ) : null}
              {needsOwnKey(value("mode")) ? (
                <p className="setup-callout wide">
                  {text(
                    "Add and test the key in Settings before a customer writes in. Until it passes its test the assistant has no model and hands every message over.",
                    "Bir müşteri yazmadan önce anahtarı Ayarlar'da ekleyip test edin. Testi geçene kadar asistanın modeli yoktur ve her mesajı devreder.",
                    "پیش از آنکه مشتری پیام دهد، کلید را در تنظیمات افزوده و آزمایش کنید. تا وقتی آزمایش را نگذراند دستیار مدلی ندارد و هر پیام را واگذار می‌کند."
                  )}{" "}
                  <Link href="/settings#ai-provider">{t("common.open")}</Link>
                </p>
              ) : null}
              <fieldset className="setup-choices wide">
                <legend>{t("onboarding.tone")}</legend>
                <div className="setup-levels">
                  {(["friendly", "formal"] as const).map((tone) => (
                    <label key={tone}>
                      <input
                        type="radio"
                        name="tone"
                        value={tone}
                        checked={value("tone") === tone}
                        onChange={() => commit("tone", tone)}
                      />
                      <span>
                        {tone === "friendly"
                          ? text("Warm and informal", "Sıcak ve samimi", "گرم و خودمانی")
                          : text("Formal", "Resmî", "رسمی")}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          ) : null}

          {stage === "connect" ? (
            <>
              <ul className="setup-readiness wide">
                {[
                  {
                    ok: hasOpenDay(hoursDraft),
                    stage: "hours" as const,
                    label: text(
                      "It can say when you are open",
                      "Ne zaman açık olduğunuzu söyleyebilir",
                      "می‌تواند بگوید چه زمانی باز هستید"
                    )
                  },
                  {
                    ok: readStage(knowledgeDraft).faq !== undefined,
                    stage: "knowledge" as const,
                    label: text(
                      "It has an approved answer of your own",
                      "Kendi onayladığınız bir yanıtı var",
                      "یک پاسخ تأییدشده از خودتان دارد"
                    )
                  },
                  {
                    ok: listValue(limitsDraft, "escalationKeywords").length > 0,
                    stage: "limits" as const,
                    label: text(
                      "It knows when to fetch you",
                      "Sizi ne zaman çağıracağını biliyor",
                      "می‌داند چه زمانی شما را خبر کند"
                    )
                  },
                  {
                    ok: !cannotAnswerCustomers(String(assistantDraft.mode ?? "")),
                    stage: "assistant" as const,
                    label: text(
                      "It has a model that may answer customers",
                      "Müşterilere yanıt verebilecek bir modeli var",
                      "مدلی دارد که اجازه‌ی پاسخ به مشتری را دارد"
                    )
                  }
                ].map((row) => (
                  <li key={row.stage} className={row.ok ? "ready" : "pending"}>
                    <span aria-hidden="true">{row.ok ? "✓" : "!"}</span>
                    <span>{row.label}</span>
                    {row.ok ? null : (
                      <button
                        type="button"
                        className="button-text"
                        disabled={!ready}
                        onClick={() => setIndex(setupStages.indexOf(row.stage))}
                      >
                        {text("Fix", "Düzelt", "اصلاح")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <div className="setup-choice-grid">
                <p>
                  {text(
                    "Connect a channel when you are ready. Nothing is sent to a real customer until sending is switched on for this workspace.",
                    "Hazır olduğunuzda bir kanal bağlayın. Bu çalışma alanı için gönderim açılmadan gerçek bir müşteriye hiçbir şey gitmez.",
                    "هر وقت آماده بودید کانالی را وصل کنید. تا زمانی که ارسال برای این فضای کاری فعال نشود، چیزی به مشتری واقعی فرستاده نمی‌شود."
                  )}
                </p>
                <Link href="/connections">Instagram · {t("common.open")}</Link>
                <Link href="/connections">WhatsApp · {t("common.open")}</Link>
                <Link href="/automations/test-center">{t("automations.testCenter")}</Link>
              </div>
              <p className="setup-callout wide">{t("onboarding.incomplete")}</p>
            </>
          ) : null}
        </div>

        <footer className="setup-actions">
          <div aria-live="polite" role="status">
            {status}
            {lastSavedAt ? (
              <time dateTime={lastSavedAt}>
                {" "}
                · {t("onboarding.savedAt")}{" "}
                {new Intl.DateTimeFormat(locale, {
                  hour: "2-digit",
                  minute: "2-digit"
                }).format(new Date(lastSavedAt))}
              </time>
            ) : null}
          </div>
          <button
            type="button"
            className="button-text action-skip"
            disabled={!ready}
            onClick={() => void save("skip", true)}
          >
            {t("common.skip")}
          </button>
          <button
            type="button"
            className="button-muted action-exit"
            disabled={!ready}
            onClick={() => void saveAndLeave()}
          >
            {t("common.exit")}
          </button>
          <button
            type="button"
            className="action-continue"
            disabled={!ready}
            onClick={() =>
              void (index === setupStages.length - 1 ? saveAndLeave() : save("complete", true))
            }
          >
            {index === setupStages.length - 1 ? t("onboarding.enter") : t("common.next")}
          </button>
        </footer>
      </article>
    </section>
  );
}

/** The list a draft holds under `name`, for any stage. */
function listValue(draft: SetupDraft, name: string): readonly string[] {
  const held = draft[name];
  return Array.isArray(held) ? held.map(String) : [];
}
