"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useI18n } from "@/src/lib/i18n/client";
import type { TranslationKey } from "@/src/lib/i18n/dictionaries";
import { PreferenceControls } from "@/src/modules/workspaces/ui/preference-controls";

const stages = [
  ["welcome", "onboarding.stage.welcome", "onboarding.stage.welcome.detail"],
  ["business-profile", "onboarding.stage.profile", "onboarding.stage.profile.detail"],
  ["languages", "onboarding.stage.languages", "onboarding.stage.languages.detail"],
  ["knowledge", "onboarding.stage.knowledge", "onboarding.stage.knowledge.detail"],
  ["ai-mode", "onboarding.stage.ai", "onboarding.stage.ai.detail"],
  ["channels", "onboarding.stage.channels", "onboarding.stage.channels.detail"],
  ["first-recipe", "onboarding.stage.recipe", "onboarding.stage.recipe.detail"],
  ["simulation", "onboarding.stage.test", "onboarding.stage.test.detail"]
] as const;

type Draft = Record<string, string | number | boolean | string[]>;

const businessFields: readonly (readonly [string, TranslationKey])[] = [
  ["publicName", "onboarding.publicName"],
  ["description", "onboarding.description"],
  ["support", "onboarding.support"],
  ["hours", "onboarding.hours"],
  ["region", "onboarding.region"],
  ["links", "onboarding.links"]
];
const languageFields: readonly (readonly [string, TranslationKey])[] = [
  ["customerLanguages", "onboarding.customerLanguages"],
  ["replyLanguage", "onboarding.replyLanguage"],
  ["tone", "onboarding.tone"],
  ["responseLength", "onboarding.responseLength"],
  ["emoji", "onboarding.emoji"],
  ["escalation", "onboarding.escalation"]
];
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
  type = "text"
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  type?: "text" | "number" | "textarea";
}) {
  return (
    <label className={type === "textarea" ? "wide" : ""}>
      <span>{label}</span>
      {type === "textarea" ? (
        <textarea
          name={name}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
      ) : (
        <input
          name={name}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
      )}
    </label>
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
  const router = useRouter();
  const { locale, theme, t, text } = useI18n();
  const firstIncomplete = stages.findIndex(
    ([id]) => !initialCompleted.includes(id) && !initialSkipped.includes(id)
  );
  const restored = stages.findIndex(([id]) => id === initialStage);
  const [index, setIndex] = useState(restored >= 0 ? restored : Math.max(firstIncomplete, 0));
  const [completed, setCompleted] = useState([...initialCompleted]);
  const [skipped, setSkipped] = useState([...initialSkipped]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({ ...initialData });
  const [status, setStatus] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState(initialLastSavedAt);
  const stage = stages[index]?.[0] ?? "welcome";
  const draft = useMemo(() => drafts[stage] ?? {}, [drafts, stage]);

  function value(name: string, fallback = "") {
    return String(draft[name] ?? fallback);
  }

  function update(name: string, nextValue: string) {
    setDrafts((current) => ({
      ...current,
      [stage]: { ...(current[stage] ?? {}), [name]: nextValue }
    }));
  }

  async function save(action: "save" | "complete" | "skip", move = false) {
    setStatus(t("common.saving"));
    const response = await fetch("/api/onboarding/progress", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-csrf-token": await csrf() },
      body: JSON.stringify({
        stage,
        action,
        data:
          stage === "welcome"
            ? {
                ...(drafts[stage] ?? {}),
                defaultLocale: locale,
                preferredTheme: theme
              }
            : (drafts[stage] ?? {})
      })
    });
    if (!response.ok) {
      setStatus(
        locale === "tr"
          ? "Kayıt başarısız. Yeniden deneyin."
          : locale === "fa"
            ? "ذخیره نشد. دوباره تلاش کنید."
            : "Save failed. Try again."
      );
      return;
    }
    const result = (await response.json()) as {
      completed: string[];
      skipped: string[];
      lastSavedAt: string;
    };
    setCompleted(result.completed);
    setSkipped(result.skipped);
    setLastSavedAt(result.lastSavedAt);
    setStatus(t("common.saved"));
    if (move && index < stages.length - 1) setIndex(index + 1);
  }

  async function enterSandbox() {
    await save("save");
    const response = await fetch("/api/onboarding/complete", {
      method: "POST",
      headers: { "x-csrf-token": await csrf() }
    });
    if (response.ok) {
      router.push("/dashboard");
      router.refresh();
    }
  }

  const blurSave = () => void save("save");

  return (
    <section className="setup-program" aria-label={t("onboarding.progress")}>
      <aside className="setup-rail">
        <div
          className="setup-progress"
          role="progressbar"
          aria-label={t("onboarding.progress")}
          aria-valuenow={index + 1}
          aria-valuemin={1}
          aria-valuemax={stages.length}
        >
          <span style={{ inlineSize: `${((index + 1) / stages.length) * 100}%` }} />
        </div>
        <p className="setup-progress-label">
          {t("onboarding.progress")} · {index + 1}/{stages.length}
        </p>
        <ol>
          {stages.map(([id, title], stageIndex) => (
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
              <button type="button" onClick={() => setIndex(stageIndex)}>
                <span>{completed.includes(id) ? "✓" : stageIndex + 1}</span>
                {t(title)}
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <article className="setup-stage">
        <header>
          <div>
            <span className="eyebrow">
              {index + 1} / {stages.length}
            </span>
            <h2>{t(stages[index]?.[1] ?? "onboarding.stage.welcome")}</h2>
            <p>{t(stages[index]?.[2] ?? "onboarding.stage.welcome.detail")}</p>
          </div>
          <PreferenceControls />
        </header>

        <div className="setup-fields">
          {stage === "welcome" ? (
            <>
              <Field
                name="workspaceName"
                label={t("onboarding.workspaceName")}
                value={value("workspaceName")}
                onChange={(next) => update("workspaceName", next)}
                onBlur={blurSave}
              />
              <Field
                name="category"
                label={t("onboarding.category")}
                value={value("category")}
                onChange={(next) => update("category", next)}
                onBlur={blurSave}
              />
              <Field
                name="country"
                label={t("onboarding.country")}
                value={value("country", "TR")}
                onChange={(next) => update("country", next.toUpperCase())}
                onBlur={blurSave}
              />
              <Field
                name="timezone"
                label={t("onboarding.timezone")}
                value={value("timezone", "Europe/Istanbul")}
                onChange={(next) => update("timezone", next)}
                onBlur={blurSave}
              />
            </>
          ) : null}
          {stage === "business-profile" ? (
            <>
              {businessFields.map(([name, label], fieldIndex) => (
                <Field
                  key={name}
                  name={name}
                  label={t(label)}
                  value={value(name)}
                  type={fieldIndex === 1 ? "textarea" : "text"}
                  onChange={(next) => update(name, next)}
                  onBlur={blurSave}
                />
              ))}
            </>
          ) : null}
          {stage === "languages" ? (
            <>
              {languageFields.map(([name, label]) => (
                <Field
                  key={name}
                  name={name}
                  label={t(label)}
                  value={value(name)}
                  onChange={(next) => update(name, next)}
                  onBlur={blurSave}
                />
              ))}
            </>
          ) : null}
          {stage === "knowledge" ? (
            <>
              <Field
                name="faqQuestion"
                label={text("Approved FAQ question", "Onaylı SSS sorusu", "پرسش متداول تأییدشده")}
                value={value("faqQuestion")}
                onChange={(next) => update("faqQuestion", next)}
                onBlur={blurSave}
              />
              <Field
                name="faqAnswer"
                label={text("Approved FAQ answer", "Onaylı SSS yanıtı", "پاسخ تأییدشده")}
                value={value("faqAnswer")}
                type="textarea"
                onChange={(next) => update("faqAnswer", next)}
                onBlur={blurSave}
              />
              <Field
                name="priceName"
                label={text("Price item name", "Fiyat kalemi adı", "نام مورد قیمت")}
                value={value("priceName")}
                onChange={(next) => update("priceName", next)}
                onBlur={blurSave}
              />
              <Field
                name="priceAmount"
                label={text("Approved amount", "Onaylı tutar", "مبلغ تأییدشده")}
                value={value("priceAmount")}
                type="number"
                onChange={(next) => update("priceAmount", next)}
                onBlur={blurSave}
              />
              <Field
                name="currency"
                label={text("Currency code", "Para birimi kodu", "کد ارز")}
                value={value("currency", "USD")}
                onChange={(next) => update("currency", next.toUpperCase())}
                onBlur={blurSave}
              />
              <Field
                name="forbidden"
                label={t("onboarding.forbidden")}
                value={value("forbidden")}
                type="textarea"
                onChange={(next) => update("forbidden", next)}
                onBlur={blurSave}
              />
            </>
          ) : null}
          {stage === "ai-mode" ? (
            <>
              <label>
                <span>{t("onboarding.aiMode")}</span>
                <select
                  value={value("mode", "FREE_GEMINI_DEMO_SYNTHETIC_ONLY")}
                  onChange={(event) => update("mode", event.target.value)}
                  onBlur={blurSave}
                >
                  <option value="FREE_GEMINI_DEMO_SYNTHETIC_ONLY">Demo — synthetic only</option>
                  <option value="PLATFORM_PAID_DEFAULT">Platform paid provider</option>
                  <option value="WORKSPACE_BYOK_OPENAI">Encrypted BYOK</option>
                </select>
              </label>
              <Field
                name="confidence"
                label={t("onboarding.confidence")}
                value={value("confidence", "0.75")}
                type="number"
                onChange={(next) => update("confidence", next)}
                onBlur={blurSave}
              />
              <p className="setup-callout">{t("onboarding.incomplete")}</p>
            </>
          ) : null}
          {stage === "channels" ? (
            <div className="setup-choice-grid">
              <Link href="/connections">Instagram · {t("common.open")}</Link>
              <Link href="/connections">WhatsApp · {t("common.open")}</Link>
              <p>{t("onboarding.incomplete")}</p>
            </div>
          ) : null}
          {stage === "first-recipe" ? (
            <label className="wide">
              <span>{t("onboarding.recipe")}</span>
              <select
                value={value("recipe", "INSTAGRAM_INBOUND_DM")}
                onChange={(event) => update("recipe", event.target.value)}
                onBlur={blurSave}
              >
                <option value="INSTAGRAM_COMMENT_TO_DM">Instagram Comment → DM</option>
                <option value="INSTAGRAM_INBOUND_DM">Instagram inbound DM</option>
                <option value="WHATSAPP_INBOUND">WhatsApp inbound</option>
                <option value="WHATSAPP_CONSENTED_FOLLOWUP_REMINDER">
                  WhatsApp consented reminder
                </option>
                <option value="CROSS_CHANNEL_AFTER_HOURS_ESCALATION">
                  After-hours human handoff
                </option>
              </select>
            </label>
          ) : null}
          {stage === "simulation" ? (
            <>
              <Field
                name="testInput"
                label={t("onboarding.testInput")}
                value={value("testInput", "I need the approved price and opening hours.")}
                type="textarea"
                onChange={(next) => update("testInput", next)}
                onBlur={blurSave}
              />
              <div className="simulation-path wide">
                <strong>INBOUND → POLICY → APPROVED KNOWLEDGE → CRM</strong>
                <span>{t("onboarding.incomplete")}</span>
                <Link href="/automations/test-center">{t("automations.testCenter")}</Link>
              </div>
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
            onClick={() => void save("skip", true)}
          >
            {t("common.skip")}
          </button>
          <button type="button" className="button-muted action-exit" onClick={enterSandbox}>
            {t("common.exit")}
          </button>
          <button
            type="button"
            className="action-continue"
            onClick={() => void save("complete", true)}
          >
            {index === stages.length - 1 ? t("onboarding.enter") : t("common.next")}
          </button>
        </footer>
      </article>
    </section>
  );
}
