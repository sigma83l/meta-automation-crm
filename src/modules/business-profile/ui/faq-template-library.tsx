"use client";

import { useState } from "react";

import { useI18n } from "@/src/lib/i18n/client";
import { useHydrated } from "@/src/lib/react/use-hydrated";
import { missingTemplates, type FaqTemplate } from "../faq-templates";

async function csrf() {
  return ((await fetch("/api/auth/csrf").then((response) => response.json())) as { token: string })
    .token;
}

/**
 * The starting library: common questions, with the owner writing each answer.
 *
 * The question is supplied and the answer never is. Only the business knows its
 * own address and policies, and a prefilled answer would either be wrong or
 * plausible enough to be published unread -- which is how a workspace reached
 * production with an FAQ reading "ww" / "w".
 *
 * So this asks for the answer in place rather than seeding a blank one. The
 * same rules the rest of the app applies are applied here, for the same reason:
 * an item too short to mean anything is worse than no item, because the
 * assistant will cite it.
 */
export function FaqTemplateLibrary({
  existingQuestions
}: {
  existingQuestions: readonly string[];
}) {
  const { locale, t, text } = useI18n();
  /** Every control here is onClick-only. See useHydrated. */
  const ready = useHydrated();
  const [open, setOpen] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState("");
  const [added, setAdded] = useState<readonly string[]>([]);

  const language = locale === "tr" ? "tr" : locale === "fa" ? "fa" : "en";
  const remaining = missingTemplates([...existingQuestions, ...added], language);

  function start(template: FaqTemplate) {
    setOpen(template.id);
    setAnswer("");
    setIssue("");
  }

  async function save(template: FaqTemplate) {
    const written = answer.trim();
    // The same floor `addFaq` enforces, checked here so the refusal explains
    // itself rather than arriving as a failed request.
    if (written.length < 12 || written.split(/\s+/).filter(Boolean).length < 2) {
      setIssue(
        text(
          "Write a real answer — a customer will be shown these words.",
          "Gerçek bir yanıt yazın; müşteri tam olarak bu sözleri görecek.",
          "پاسخ واقعی بنویسید؛ مشتری دقیقاً همین کلمات را می‌بیند."
        )
      );
      return;
    }
    setBusy(true);
    setIssue("");
    try {
      const response = await fetch("/api/settings/faqs", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": await csrf() },
        body: JSON.stringify({
          question: template.question[language],
          answer: written,
          language
        })
      });
      if (!response.ok) {
        setIssue(t("common.retry"));
        return;
      }
      setAdded((previous) => [...previous, template.question[language]]);
      setOpen(null);
      setAnswer("");
    } catch {
      setIssue(t("common.retry"));
    } finally {
      setBusy(false);
    }
  }

  if (remaining.length === 0) {
    return (
      <p role="status">
        {text(
          "Every question in the starter library has an answer. Add your own for anything else customers ask.",
          "Başlangıç kütüphanesindeki her sorunun bir yanıtı var. Müşterilerin sorduğu diğer sorular için kendi sorularınızı ekleyin.",
          "همه پرسش‌های کتابخانه آغازین پاسخ دارند. برای سایر پرسش‌های مشتریان، مورد خودتان را بیفزایید."
        )}
      </p>
    );
  }

  return (
    <ul className="faq-templates">
      {remaining.map((template) => (
        <li key={template.id}>
          <div className="faq-template-head">
            <strong dir="auto">{template.question[language]}</strong>
            <button
              type="button"
              className="button-muted"
              disabled={!ready || busy}
              onClick={() => (open === template.id ? setOpen(null) : start(template))}
            >
              {open === template.id ? t("common.back") : t("common.open")}
            </button>
          </div>
          <p className="faq-template-hint" dir="auto">
            {template.guidance[language]}
          </p>
          {open === template.id && (
            <div className="faq-template-answer">
              <label>
                <span>{text("Your answer", "Yanıtınız", "پاسخ شما")}</span>
                <textarea
                  dir="auto"
                  rows={3}
                  value={answer}
                  maxLength={2000}
                  onChange={(event) => setAnswer(event.target.value)}
                />
              </label>
              {issue && <p role="alert">{issue}</p>}
              <button type="button" disabled={!ready || busy} onClick={() => save(template)}>
                {busy ? t("common.saving") : t("common.save")}
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
