/**
 * What onboarding asks, what a usable answer looks like, and what each answer
 * becomes.
 *
 * Shared by the form and by `PATCH /api/onboarding/progress` on purpose. The
 * two used to disagree about everything that mattered: the form defaulted the
 * AI mode to a mode that cannot answer and the route fell back to the same one,
 * the form offered a free-text language and the route stored whatever arrived,
 * and the form collected business hours that the route simply dropped. Each of
 * those is a difference of opinion between a screen and a writer, so the
 * opinion lives here once and both sides read it.
 *
 * The organising question is not "what could we ask a business" but "what does
 * a turn need before it can answer a customer safely". `loadTurnContext` reads
 * six things from a workspace - approved FAQs, approved prices, language,
 * forbidden claims, escalation keywords and a confidence threshold - plus
 * business hours, which never reach the model and act only as the validator's
 * allowlist of times a reply may state. Anything asked for that does not end up
 * in one of those costs a person time and changes nothing.
 */

export const setupStages = [
  "welcome",
  "hours",
  "knowledge",
  "limits",
  "assistant",
  "connect"
] as const;
export type SetupStage = (typeof setupStages)[number];

export type SetupValue = string | number | boolean | readonly string[];
export type SetupDraft = Readonly<Record<string, SetupValue>>;

/**
 * The languages a workspace may pick as the one its customers are answered in.
 *
 * A closed list because the column is bare `text` and the contract was
 * `min(2).max(16)`, so `primary_language = "jgwejf"` was valid all the way to
 * the model, where it becomes the sentence "Prefer jgwejf" in the system
 * prompt. Codes rather than names, because that is what the column already
 * holds and what `fallback_language` defaults to.
 */
export const setupLanguages = ["tr", "en", "fa", "ar", "de", "fr", "ru", "es"] as const;
export type SetupLanguage = (typeof setupLanguages)[number];

export const setupCurrencies = ["TRY", "USD", "EUR", "GBP"] as const;
export type SetupCurrency = (typeof setupCurrencies)[number];

export const weekdays = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
] as const;
export type Weekday = (typeof weekdays)[number];

/** The one non-time value a day may hold. */
export const CLOSED = "closed";

/** `monday` -> `hoursMonday`, the stage-data key the day is stored under. */
export function hoursKey(day: Weekday): string {
  return `hours${day[0]!.toUpperCase()}${day.slice(1)}`;
}

/**
 * How often a person should be pulled in, as a threshold.
 *
 * The stored value is `low_confidence_threshold`, a number between 0 and 1 that
 * the model is told to compare its own confidence against. A number input asked
 * a shop owner to have an opinion about a probability; these three say the same
 * thing in terms someone actually has an opinion about.
 */
export const handoverLevels = {
  often: 0.9,
  balanced: 0.75,
  rarely: 0.5
} as const;
export type HandoverLevel = keyof typeof handoverLevels;

/**
 * The AI modes onboarding offers, in the order it offers them.
 *
 * `FREE_GEMINI_DEMO_SYNTHETIC_ONLY` is last and never a default.
 * `providersForWorkspace` returns no provider at all for it, because the mode
 * is restricted to synthetic data and a webhook message is never synthetic - so
 * every turn on a workspace in that mode produces an empty draft and a handoff.
 * It used to be first in the list and the fallback in both the form and the
 * route, and real workspaces were left there by people who changed nothing.
 */
export const setupAiModes = [
  "PLATFORM_PAID_DEFAULT",
  "WORKSPACE_BYOK_OPENAI",
  "FREE_GEMINI_DEMO_SYNTHETIC_ONLY"
] as const;
export type SetupAiMode = (typeof setupAiModes)[number];

export const DEFAULT_AI_MODE: SetupAiMode = "PLATFORM_PAID_DEFAULT";

/** Modes needing a credential that is entered in settings, not here. */
export function needsOwnKey(mode: string): boolean {
  return mode.startsWith("WORKSPACE_BYOK_");
}

/** Whether the mode leaves the assistant unable to answer a real customer. */
export function cannotAnswerCustomers(mode: string): boolean {
  return mode === "FREE_GEMINI_DEMO_SYNTHETIC_ONLY";
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

export type DayHours =
  Readonly<{ open: false }> | Readonly<{ open: true; from: string; to: string }>;

/** Reads one day out of stage data, treating anything unparseable as closed. */
export function dayHours(draft: SetupDraft, day: Weekday): DayHours {
  const raw = String(draft[hoursKey(day)] ?? "").trim();
  if (!raw || raw === CLOSED) return { open: false };
  const [from = "", to = ""] = raw.split("-");
  return TIME_OF_DAY.test(from) && TIME_OF_DAY.test(to) && from !== to
    ? { open: true, from, to }
    : { open: false };
}

export function serialiseDay(hours: DayHours): string {
  return hours.open ? `${hours.from}-${hours.to}` : CLOSED;
}

const englishDay: Readonly<Record<Weekday, string>> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday"
};

/**
 * The `business_hours` object, whose values each name their own day.
 *
 * That shape is the whole point of this function. `loadTurnContext` builds the
 * validator's approved times from `Object.values(business_hours)`, so the keys
 * are discarded before anything reads them: a row storing `{saturday:
 * "closed"}` approved the word "closed" and nothing else, after which a reply
 * saying "we are closed on Saturday" was blocked for naming an unapproved time
 * and the conversation went to a person. Writing "Saturday closed" as the value
 * approves the day itself, which is what the business actually said.
 *
 * The day names are English even when the workspace answers in another
 * language, because the validator's weekday list is English and this object is
 * a machine allowlist rather than anything a customer reads.
 */
export function businessHoursFrom(draft: SetupDraft): Record<string, string> {
  const hours: Record<string, string> = {};
  for (const day of weekdays) {
    const value = dayHours(draft, day);
    hours[day] = value.open
      ? `${englishDay[day]} ${value.from} to ${value.to}`
      : `${englishDay[day]} ${CLOSED}`;
  }
  return hours;
}

/** Whether the day rows say anything - all seven closed says nothing. */
export function hasOpenDay(draft: SetupDraft): boolean {
  return weekdays.some((day) => dayHours(draft, day).open);
}

const localisedDays: Readonly<Record<"en" | "tr" | "fa", Readonly<Record<Weekday, string>>>> = {
  en: englishDay,
  tr: {
    monday: "Pazartesi",
    tuesday: "Salı",
    wednesday: "Çarşamba",
    thursday: "Perşembe",
    friday: "Cuma",
    saturday: "Cumartesi",
    sunday: "Pazar"
  },
  fa: {
    monday: "دوشنبه",
    tuesday: "سه‌شنبه",
    wednesday: "چهارشنبه",
    thursday: "پنجشنبه",
    friday: "جمعه",
    saturday: "شنبه",
    sunday: "یکشنبه"
  }
};

const closedWord = { en: "closed", tr: "kapalı", fa: "تعطیل" } as const;
const toWord = { en: "to", tr: "-", fa: "تا" } as const;

/** The locale the generated copy exists in, for a language that may be any of eight. */
function copyLocale(language: string): "en" | "tr" | "fa" {
  return language === "tr" ? "tr" : language === "fa" ? "fa" : "en";
}

/**
 * Every wording onboarding has given the generated hours FAQ.
 *
 * Matched against as a set rather than only the current locale's wording, so a
 * workspace that switches its reply language updates the entry it already has
 * instead of ending up with two opening-hours answers that can disagree.
 */
export const openingHoursQuestions = {
  en: "What are your opening hours?",
  tr: "Çalışma saatleriniz nedir?",
  fa: "ساعات کاری شما چیست؟"
} as const;

/**
 * The question and answer that turn opening hours into something answerable.
 *
 * Hours alone cannot answer anybody. `AiReplyInput` carries approved FAQs and
 * approved prices and nothing else - business hours never reach the model, they
 * only permit the validator to let a time through. A workspace that filled in
 * seven days of hours and stopped had an assistant that still could not say
 * when it was open, which is the most common question a shop is asked. So the
 * hours are written a second time, as an approved FAQ, which is the form the
 * model can read.
 *
 * Phrased in the language the workspace answers customers in, and only in the
 * three the product has copy for; anything else falls back to English rather
 * than shipping a half-translated sentence.
 */
export function openingHoursFaq(
  draft: SetupDraft,
  language: string
): Readonly<{ question: string; answer: string }> {
  const locale = copyLocale(language);
  const days = localisedDays[locale];
  const lines = weekdays.map((day) => {
    const value = dayHours(draft, day);
    return value.open
      ? `${days[day]}: ${value.from} ${toWord[locale]} ${value.to}`
      : `${days[day]}: ${closedWord[locale]}`;
  });
  return { question: openingHoursQuestions[locale], answer: lines.join("\n") };
}

/** Suggested handover triggers, so a workspace has working ones without typing. */
export const suggestedTriggers = {
  en: ["refund", "complaint", "cancel", "urgent", "lawyer", "broken"],
  tr: ["iade", "şikayet", "iptal", "acil", "avukat", "arızalı"],
  fa: ["بازپرداخت", "شکایت", "لغو", "فوری", "وکیل", "خراب"]
} as const;

/** Suggested things the assistant must never say, phrased as promises. */
export const suggestedForbidden = {
  en: [
    "guaranteed results",
    "same-day delivery",
    "full refund at any time",
    "this will cure your condition"
  ],
  tr: [
    "garantili sonuç",
    "aynı gün teslimat",
    "her zaman tam iade",
    "bu rahatsızlığınızı iyileştirir"
  ],
  fa: [
    "نتیجه تضمینی",
    "تحویل همان روز",
    "بازپرداخت کامل در هر زمان",
    "این بیماری شما را درمان می‌کند"
  ]
} as const;

export function suggestionsFor(
  table: Readonly<Record<"en" | "tr" | "fa", readonly string[]>>,
  language: string
): readonly string[] {
  return table[copyLocale(language)];
}

/**
 * A weekday as a person reads it.
 *
 * From this table rather than `Intl.DateTimeFormat`, because the form renders
 * on the server and again in the browser, and two ICU builds that disagree
 * about a single name turn into a hydration mismatch on a screen whose whole
 * job is being trustworthy.
 */
export function weekdayLabel(day: Weekday, language: string): string {
  return localisedDays[copyLocale(language)][day];
}

/**
 * What a stage holds before anybody types anything.
 *
 * Materialised into the draft rather than only shown as a placeholder, and that
 * distinction is the defect: the AI mode, the confidence threshold and the
 * hours all had sensible-looking fallbacks in the markup, but a person who read
 * them, agreed, and pressed Continue sent a stage with none of them in it. The
 * form submits these merged under whatever was typed, so agreeing by doing
 * nothing now stores the same thing as agreeing by clicking.
 */
export function defaultsFor(stage: SetupStage, language: string, timezone: string): SetupDraft {
  switch (stage) {
    case "welcome":
      return { workspaceName: "", replyLanguage: language };
    case "hours":
      return {
        timezone,
        ...Object.fromEntries(
          weekdays.map((day) => [
            hoursKey(day),
            day === "saturday" || day === "sunday" ? CLOSED : "09:00-18:00"
          ])
        )
      };
    case "knowledge":
      return {
        faqQuestion: "",
        faqAnswer: "",
        priceName: "",
        priceAmount: "",
        currency: language === "tr" ? "TRY" : "USD"
      };
    case "limits":
      return {
        escalationKeywords: suggestionsFor(suggestedTriggers, language).slice(0, 4),
        forbiddenClaims: [],
        handover: "balanced" satisfies HandoverLevel
      };
    case "assistant":
      return { mode: DEFAULT_AI_MODE, tone: "friendly" };
    case "connect":
      return {};
  }
}

/**
 * Why a value cannot be stored, as a code the caller renders in its own
 * language. The route has no access to the UI dictionary, and the form should
 * not have to parse English out of a response.
 */
export const setupIssues = [
  "required",
  "tooShort",
  "notAQuestion",
  "notAnAmount",
  "notATimezone",
  "notAChoice",
  "noOpenDay"
] as const;
export type SetupIssue = (typeof setupIssues)[number];
export type SetupIssues = Readonly<Record<string, SetupIssue>>;

function words(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function list(value: SetupValue | undefined): readonly string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
}

/**
 * The rules that keep a workspace's knowledge worth reading.
 *
 * They exist because of what live rows actually contain: a FAQ asking "jhj"
 * answered "w", a forbidden claim of "wef", an escalation keyword of "uyjgefu".
 * None of that is a mistake somebody would have made in a field that had told
 * them what it was for, and all of it reaches a customer-facing model as fact.
 * The checks are shallow on purpose - length, shape, a question mark - because
 * the honest limit of a form is catching an answer nobody meant, not judging
 * one somebody did.
 *
 * Empty is not an issue here. Every stage is skippable, so "not filled in yet"
 * is a legitimate state; what is checked is that whatever *was* filled in can
 * be used.
 */
export function validateStage(stage: SetupStage, draft: SetupDraft): SetupIssues {
  const issues: Record<string, SetupIssue> = {};
  const text = (name: string) => String(draft[name] ?? "").trim();

  if (stage === "welcome") {
    const name = text("workspaceName");
    if (name && name.length < 2) issues.workspaceName = "tooShort";
    const language = text("replyLanguage");
    if (language && !(setupLanguages as readonly string[]).includes(language)) {
      issues.replyLanguage = "notAChoice";
    }
  }

  if (stage === "hours") {
    const timezone = text("timezone");
    if (!timezone) issues.timezone = "required";
    else if (!isTimezone(timezone)) issues.timezone = "notATimezone";
    // Seven closed days is a business that is never open. Far more likely to be
    // a row of controls nobody reached than a statement about the shop.
    if (!hasOpenDay(draft)) issues.days = "noOpenDay";
  }

  if (stage === "knowledge") {
    const question = text("faqQuestion");
    const answer = text("faqAnswer");
    if (question || answer) {
      if (!question) issues.faqQuestion = "required";
      else if (question.length < 8 || words(question) < 2) issues.faqQuestion = "tooShort";
      else if (!/[?？؟]$/.test(question)) issues.faqQuestion = "notAQuestion";
      if (!answer) issues.faqAnswer = "required";
      else if (answer.length < 12 || words(answer) < 2) issues.faqAnswer = "tooShort";
    }
    const priceName = text("priceName");
    const amount = text("priceAmount");
    if (priceName || amount) {
      if (!priceName) issues.priceName = "required";
      else if (priceName.length < 2) issues.priceName = "tooShort";
      const parsed = Number(amount);
      if (!amount) issues.priceAmount = "required";
      else if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10_000_000) {
        issues.priceAmount = "notAnAmount";
      }
      if (!(setupCurrencies as readonly string[]).includes(text("currency"))) {
        issues.currency = "notAChoice";
      }
    }
  }

  if (stage === "limits") {
    if (list(draft.escalationKeywords).some((entry) => entry.length < 3 || entry.length > 40)) {
      issues.escalationKeywords = "tooShort";
    }
    if (list(draft.forbiddenClaims).some((entry) => entry.length < 8 || entry.length > 200)) {
      issues.forbiddenClaims = "tooShort";
    }
    if (!Object.keys(handoverLevels).includes(text("handover"))) issues.handover = "notAChoice";
  }

  if (stage === "assistant") {
    if (!(setupAiModes as readonly string[]).includes(text("mode"))) issues.mode = "notAChoice";
    if (!["friendly", "formal"].includes(text("tone"))) issues.tone = "notAChoice";
  }

  return issues;
}

export type StageReading = Readonly<{
  workspaceName?: string;
  replyLanguage?: SetupLanguage;
  timezone?: string;
  faq?: Readonly<{ question: string; answer: string }>;
  price?: Readonly<{ name: string; amountMinor: number; currency: SetupCurrency }>;
  escalationKeywords: readonly string[];
  forbiddenClaims: readonly string[];
  handover?: number;
  mode?: SetupAiMode;
  tone?: "friendly" | "formal";
}>;

/**
 * The values a draft yields, omitting anything not usable.
 *
 * Omission rather than substitution: the route writes only the keys that are
 * present, so a half-typed FAQ leaves the previous one alone instead of
 * replacing it with a default nobody chose. That is what lets autosave run on
 * every blur without a partially typed field ever reaching the model.
 */
export function readStage(draft: SetupDraft): StageReading {
  const text = (name: string) => String(draft[name] ?? "").trim();
  const question = text("faqQuestion");
  const answer = text("faqAnswer");
  const priceName = text("priceName");
  const amount = Math.round(Number(text("priceAmount")) * 100);
  const currency = text("currency");
  const handover = text("handover");
  const mode = text("mode");
  const tone = text("tone");
  const language = text("replyLanguage");
  const timezone = text("timezone");
  const name = text("workspaceName");
  const knowledgeIssues = validateStage("knowledge", draft);
  const faqIsUsable =
    Boolean(question && answer) && !knowledgeIssues.faqQuestion && !knowledgeIssues.faqAnswer;

  return {
    ...(name.length >= 2 ? { workspaceName: name.slice(0, 120) } : {}),
    ...((setupLanguages as readonly string[]).includes(language)
      ? { replyLanguage: language as SetupLanguage }
      : {}),
    ...(timezone && isTimezone(timezone) ? { timezone } : {}),
    ...(faqIsUsable ? { faq: { question, answer } } : {}),
    ...(priceName.length >= 2 &&
    Number.isSafeInteger(amount) &&
    amount > 0 &&
    (setupCurrencies as readonly string[]).includes(currency)
      ? { price: { name: priceName, amountMinor: amount, currency: currency as SetupCurrency } }
      : {}),
    escalationKeywords: list(draft.escalationKeywords)
      .filter((entry) => entry.length >= 3 && entry.length <= 40)
      .slice(0, 20),
    forbiddenClaims: list(draft.forbiddenClaims)
      .filter((entry) => entry.length >= 8 && entry.length <= 200)
      .slice(0, 20),
    ...(handover in handoverLevels ? { handover: handoverLevels[handover as HandoverLevel] } : {}),
    ...((setupAiModes as readonly string[]).includes(mode) ? { mode: mode as SetupAiMode } : {}),
    ...(tone === "friendly" || tone === "formal" ? { tone } : {})
  };
}
