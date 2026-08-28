"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "@/src/lib/i18n/client";
import type { EvidenceLink, NowCard, NowField } from "../now-card";
import {
  CONFIDENCE_LABELS,
  DUE_STATE_LABELS,
  LEAD_STATUS_LABELS,
  LIFECYCLE_LABELS,
  NEXT_ACTION_LABELS,
  PRIORITY_LABELS
} from "./vocabulary";

/**
 * The Now card.
 *
 * Every field renders the same way, which is the point: a value with what backs
 * it, or the words Unknown / needs confirmation. There is no branch here that
 * omits a field it has no value for, because a card that quietly drops its gaps
 * reads as a complete picture of the customer and somebody acts on it.
 *
 * Evidence becomes a link only where a route exists to link to. A conversation
 * has one. A score snapshot and a memory source reference do not yet, so they
 * are shown as what they are - a reference an operator can quote in the Audit
 * section - rather than as a link that goes nowhere.
 */
export function NowCardPanel({ card, customerId }: { card: NowCard; customerId: string }) {
  const { text, locale } = useI18n();
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <section className="now-card" aria-label={text("Now", "Şu an", "اکنون")}>
      <div className="now-heading">
        <span className="eyebrow">{text("Now", "Şu an", "اکنون")}</span>
        <span className="priority-chip" data-priority={card.attention.priority}>
          {text(...PRIORITY_LABELS[card.attention.priority])}
        </span>
        {card.attention.reasons.map((reason) => (
          <span key={reason.code} className="reason-chip" data-effect={reason.effect}>
            {reason.code.replaceAll("_", " ")}
          </span>
        ))}
      </div>

      <dl className="now-fields">
        <Field label={text("Current need", "Güncel ihtiyaç", "نیاز فعلی")}>
          <Value field={card.currentIntent} render={(value) => value} />
        </Field>
        <Field label={text("Desired outcome", "İstenen sonuç", "نتیجه مطلوب")}>
          <Value field={card.desiredOutcome} render={(value) => value} />
        </Field>
        <Field label={text("Lifecycle", "Yaşam döngüsü", "چرخه عمر")}>
          <span className="status-pill">{text(...LIFECYCLE_LABELS[card.lifecycleStage])}</span>
        </Field>
        <Field label={text("Status", "Durum", "وضعیت")}>
          <span className="status-pill">{text(...LEAD_STATUS_LABELS[card.leadStatus])}</span>
        </Field>
        <Field label={text("Qualification score", "Nitelik puanı", "امتیاز صلاحیت")}>
          <Value field={card.score} render={(value) => String(value)} />
        </Field>
        <Field label={text("Strongest evidence", "En güçlü kanıt", "قوی‌ترین شواهد")}>
          <Value
            field={card.strongestEvidence}
            render={(driver) =>
              `${driver.component.replaceAll("_", " ")} (+${driver.contribution})`
            }
          />
        </Field>
        <Field label={text("Strongest blocker", "En büyük engel", "بزرگ‌ترین مانع")}>
          <Value
            field={card.strongestBlocker}
            render={(blocker) =>
              `${blocker.component.replaceAll("_", " ")} — ${blocker.reason.replaceAll("_", " ")} (−${blocker.cost})`
            }
          />
        </Field>
        <Field label={text("Data confidence", "Veri güveni", "اطمینان داده")}>
          {card.dataConfidence ? text(...CONFIDENCE_LABELS[card.dataConfidence]) : <Unknown />}
        </Field>
        <Field label={text("Next action", "Sonraki adım", "اقدام بعدی")}>
          {text(...NEXT_ACTION_LABELS[card.nextAction.type])}
          <small>{card.nextAction.reasonCodes.join(", ") || "—"}</small>
        </Field>
        <Field label={text("Action owner", "Adımın sahibi", "مسئول اقدام")}>
          {card.nextAction.ownerType === "human" && card.nextAction.ownerId
            ? text("A teammate", "Bir ekip üyesi", "یکی از هم‌تیمی‌ها")
            : card.nextAction.ownerType === "human"
              ? text("Unassigned", "Atanmamış", "بدون مسئول")
              : card.nextAction.ownerType}
        </Field>
        <Field label={text("Due", "Zamanı", "موعد")}>
          {text(...DUE_STATE_LABELS[card.dueState])}
          {card.nextAction.dueAt ? (
            <small>
              <time dateTime={card.nextAction.dueAt}>
                {when.format(new Date(card.nextAction.dueAt))}
              </time>
            </small>
          ) : null}
        </Field>
        <Field label={text("Handled by", "Yürüten", "پاسخ‌دهنده")}>
          {card.handling === "human" ? (
            text("A person took over", "Bir kişi devraldı", "یک نفر تحویل گرفته است")
          ) : card.handling === "automation" ? (
            text("Automation", "Otomasyon", "اتوماسیون")
          ) : (
            <Unknown />
          )}
        </Field>
        <Field label={text("Last message", "Son mesaj", "آخرین پیام")}>
          <Value
            field={card.lastMessage}
            render={(message) => (
              <>
                {message.excerpt}
                <small>
                  <time dateTime={message.at}>{when.format(new Date(message.at))}</time>
                </small>
              </>
            )}
          />
        </Field>
      </dl>

      <p className="now-footnote">
        <Link href={`/crm/${customerId}?section=audit`}>
          {text(
            "Every value here is derived from the record's own events.",
            "Buradaki her değer kaydın kendi olaylarından türetilir.",
            "هر مقدار اینجا از رویدادهای همین رکورد استخراج شده است."
          )}
        </Link>
      </p>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="now-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * One value, or the admission that there is none.
 *
 * The `render` callback exists so a field's shape stays in one place and the
 * unknown case cannot be forgotten: there is no way to render a value here
 * without going past the null check.
 */
function Value<T>({ field, render }: { field: NowField<T>; render: (value: T) => ReactNode }) {
  const { text } = useI18n();
  if (!field) return <Unknown />;
  return (
    <>
      {render(field.value)}
      {field.confidence ? (
        <small className="confidence">{text(...CONFIDENCE_LABELS[field.confidence])}</small>
      ) : null}
      {field.evidence ? <Evidence link={field.evidence} /> : null}
    </>
  );
}

function Unknown() {
  const { text } = useI18n();
  return (
    <em className="unknown-value">
      {text("Unknown / needs confirmation", "Bilinmiyor / doğrulanmalı", "نامشخص / نیاز به تأیید")}
    </em>
  );
}

function Evidence({ link }: { link: EvidenceLink }) {
  const { text } = useI18n();
  if (link.kind === "conversation") {
    return (
      <small>
        <Link href={`/inbox?conversation=${encodeURIComponent(link.ref)}`}>
          {text("Open conversation", "Konuşmayı aç", "باز کردن گفتگو")}
        </Link>
      </small>
    );
  }
  // No route to link to yet. Naming the reference is honest; a link that goes
  // nowhere is not.
  return (
    <small className="evidence-ref" dir="auto">
      {text("Source", "Kaynak", "منبع")}: {link.ref}
    </small>
  );
}
