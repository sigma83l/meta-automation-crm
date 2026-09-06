"use client";

import Link from "next/link";
import { useI18n } from "@/src/lib/i18n/client";
import type { StoredFieldDefinition, StoredFieldValue, StoredFollowUp } from "../contracts";
import type { TimelineCategory, TimelineEvent } from "../timeline";
import { TIMELINE_CATEGORIES } from "../timeline";
import type { StoredFact } from "@/src/modules/rcos/memory-policy";
import {
  CONFIDENCE_LABELS,
  TIMELINE_ACTOR_LABELS,
  TIMELINE_CATEGORY_LABELS,
  TIMELINE_KIND_LABELS
} from "./vocabulary";

/**
 * The record's sections, other than the Now card.
 *
 * Each one renders the rows it is about rather than the columns they happen to
 * have. That is the whole difference from what stood here before: a list of
 * key/value pairs from every table is a database browser, and `14_RECORD_DETAIL_UX.md`
 * names the raw object dump first among the things to avoid. The dump survives
 * in Audit, where a raw event trace is the point.
 */

function Empty({ children }: { children: string }) {
  return <div className="empty-guidance">{children}</div>;
}

export function TimelineSection({
  events,
  customerId,
  categories,
  includeRoutine
}: {
  events: readonly TimelineEvent[];
  customerId: string;
  categories: readonly TimelineCategory[];
  includeRoutine: boolean;
}) {
  const { text, locale } = useI18n();
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const href = (over: { category?: TimelineCategory | null; routine?: boolean }) => {
    const params = new URLSearchParams({ section: "timeline" });
    const next =
      over.category === undefined
        ? categories
        : over.category === null
          ? []
          : categories.includes(over.category)
            ? categories.filter((category) => category !== over.category)
            : [...categories, over.category];
    for (const category of next) params.append("category", category);
    if (over.routine ?? includeRoutine) params.set("routine", "1");
    return `/crm/${customerId}?${params}`;
  };

  return (
    <>
      <nav
        className="timeline-filters"
        aria-label={text("Timeline filters", "Zaman çizelgesi filtreleri", "فیلترهای خط زمانی")}
      >
        <Link href={href({ category: null })} aria-current={categories.length ? undefined : "page"}>
          {text("Everything", "Tümü", "همه")}
        </Link>
        {TIMELINE_CATEGORIES.map((category) => (
          <Link
            key={category}
            href={href({ category })}
            aria-current={categories.includes(category) ? "page" : undefined}
          >
            {text(...TIMELINE_CATEGORY_LABELS[category])}
          </Link>
        ))}
        <Link
          href={href({ routine: !includeRoutine })}
          aria-current={includeRoutine ? "page" : undefined}
        >
          {includeRoutine
            ? text(
                "Hide automation detail",
                "Otomasyon ayrıntısını gizle",
                "پنهان کردن جزئیات اتوماسیون"
              )
            : text(
                "Show automation detail",
                "Otomasyon ayrıntısını göster",
                "نمایش جزئیات اتوماسیون"
              )}
        </Link>
      </nav>
      {events.length === 0 ? (
        <Empty>
          {text(
            "Nothing has happened here yet.",
            "Burada henüz bir şey olmadı.",
            "هنوز چیزی رخ نداده است."
          )}
        </Empty>
      ) : (
        <ol className="timeline">
          {events.map((event) => (
            <li key={event.id} data-routine={event.routine ? "1" : undefined}>
              <div className="timeline-head">
                <strong>{text(...TIMELINE_KIND_LABELS[event.kind])}</strong>
                <span>{text(...TIMELINE_ACTOR_LABELS[event.actor])}</span>
                <time dateTime={event.at}>{when.format(new Date(event.at))}</time>
              </div>
              {event.text ? (
                <p dir="auto">{event.text}</p>
              ) : Object.values(event.detail).some(Boolean) ? (
                <p>
                  {Object.entries(event.detail)
                    .filter(([, value]) => value)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(" · ")}
                </p>
              ) : null}
              {event.evidence?.kind === "conversation" ? (
                <Link href={`/inbox?conversation=${encodeURIComponent(event.evidence.ref)}`}>
                  {text("Open conversation", "Konuşmayı aç", "باز کردن گفتگو")}
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/**
 * Customer memory.
 *
 * Every fact shows its confidence and where it came from, because that is the
 * difference between something the customer said and something a model decided.
 * An expired fact is shown as expired rather than hidden: the record is where
 * somebody goes to correct memory, and they cannot correct what they cannot see.
 */
export function MemorySection({ facts, now }: { facts: readonly StoredFact[]; now: string }) {
  const { text, locale } = useI18n();
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  if (facts.length === 0) {
    return (
      <Empty>
        {text(
          "Nothing has been remembered about this contact yet.",
          "Bu kişi hakkında henüz bir şey hatırlanmıyor.",
          "هنوز چیزی درباره این مخاطب به خاطر سپرده نشده است."
        )}
      </Empty>
    );
  }
  return (
    <ul className="memory-list">
      {facts.map((fact) => {
        const expired = Boolean(fact.validUntil && fact.validUntil <= now);
        return (
          <li key={fact.key} data-expired={expired ? "1" : undefined}>
            <strong dir="auto">{fact.key.replaceAll("_", " ")}</strong>
            <span dir="auto">{fact.value}</span>
            <small>
              {text(...CONFIDENCE_LABELS[fact.confidence])} · {text("Source", "Kaynak", "منبع")}:{" "}
              {fact.sourceRef} ·{" "}
              <time dateTime={fact.recordedAt}>{when.format(new Date(fact.recordedAt))}</time>
              {expired ? ` · ${text("Expired", "Süresi doldu", "منقضی شده")}` : ""}
            </small>
          </li>
        );
      })}
    </ul>
  );
}

/** Follow-ups, with the two things that make one justifiable rather than a timer. */
export function FollowUpSection({ followUps }: { followUps: readonly StoredFollowUp[] }) {
  const { text, locale } = useI18n();
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  if (followUps.length === 0) {
    return (
      <Empty>
        {text(
          "No follow-up is scheduled for this contact.",
          "Bu kişi için planlanmış takip yok.",
          "پیگیری‌ای برای این مخاطب زمان‌بندی نشده است."
        )}
      </Empty>
    );
  }
  return (
    <ul className="followup-list">
      {followUps.map((followUp) => (
        <li key={followUp.id}>
          <strong dir="auto">{followUp.objective}</strong>
          <span className="status-pill">{followUp.eligibilityState}</span>
          <small>
            {text("Stops when", "Şu olursa durur", "توقف در صورت")}: {followUp.cancelCondition}
          </small>
          <small>
            <time dateTime={followUp.dueAt}>{when.format(new Date(followUp.dueAt))}</time> ·{" "}
            {followUp.ownerType} · {followUp.attempts} {text("attempts", "deneme", "تلاش")}
            {followUp.lastResult ? ` · ${followUp.lastResult}` : ""}
          </small>
        </li>
      ))}
    </ul>
  );
}

export function ConversationsSection({
  conversations
}: {
  conversations: readonly Record<string, unknown>[];
}) {
  const { text, locale } = useI18n();
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  if (conversations.length === 0) {
    return (
      <Empty>
        {text(
          "No conversation has been opened with this contact.",
          "Bu kişiyle açılmış konuşma yok.",
          "هیچ گفتگویی با این مخاطب باز نشده است."
        )}
      </Empty>
    );
  }
  return (
    <ul className="conversation-summaries">
      {conversations.map((conversation) => (
        <li key={String(conversation.id)}>
          <Link href={`/inbox?conversation=${encodeURIComponent(String(conversation.id))}`}>
            {String(conversation.channel)}
          </Link>
          <span className="status-pill">{String(conversation.state)}</span>
          <small>
            {String(conversation.owner)} · {Number(conversation.unread_count ?? 0)}{" "}
            {text("unread", "okunmamış", "خوانده‌نشده")}
            {conversation.last_message_at
              ? ` · ${when.format(new Date(String(conversation.last_message_at)))}`
              : ""}
          </small>
        </li>
      ))}
    </ul>
  );
}

export function FilesSection({ files }: { files: readonly Record<string, unknown>[] }) {
  const { text, locale } = useI18n();
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const live = files.filter((file) => !file.deleted_at);
  if (live.length === 0) {
    return <Empty>{text("No files yet.", "Henüz dosya yok.", "هنوز فایلی نیست.")}</Empty>;
  }
  return (
    <ul className="file-list">
      {live.map((file) => (
        <li key={String(file.id)}>
          <strong dir="auto">{String(file.original_name)}</strong>
          <small>
            {String(file.mime_type)} · {Math.ceil(Number(file.byte_size ?? 0) / 1024)} KB ·{" "}
            <time dateTime={String(file.created_at)}>
              {when.format(new Date(String(file.created_at)))}
            </time>
          </small>
        </li>
      ))}
    </ul>
  );
}

export function AutomationsSection({
  automations
}: {
  automations: readonly Record<string, unknown>[];
}) {
  const { text } = useI18n();
  if (automations.length === 0) {
    return (
      <Empty>
        {text(
          "No automation is linked to this contact.",
          "Bu kişiye bağlı otomasyon yok.",
          "اتوماسیونی به این مخاطب متصل نیست."
        )}
      </Empty>
    );
  }
  return (
    <ul className="automation-list">
      {automations.map((automation) => (
        <li key={String(automation.id)}>
          <strong dir="auto">{String(automation.automation_key)}</strong>
          <span className="status-pill">{String(automation.state)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Custom fields and notes.
 *
 * A field shows which writer set it and how sure they were, since the whole
 * point of the `ai_write` permission is that a model's value and a person's are
 * not interchangeable.
 */
export function FieldsSection({
  definitions,
  values,
  notes
}: {
  definitions: readonly StoredFieldDefinition[];
  values: readonly StoredFieldValue[];
  notes: readonly Record<string, unknown>[];
}) {
  const { text, locale } = useI18n();
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const byKey = new Map(values.map((value) => [value.fieldKey, value]));
  return (
    <>
      <h4>{text("Fields", "Alanlar", "فیلدها")}</h4>
      {definitions.length === 0 ? (
        <Empty>
          {text(
            "This workspace has not defined any custom fields.",
            "Bu çalışma alanı özel alan tanımlamadı.",
            "این فضای کاری فیلد سفارشی تعریف نکرده است."
          )}
        </Empty>
      ) : (
        <ul className="field-list">
          {definitions.map((definition) => {
            const value = byKey.get(definition.fieldKey);
            return (
              <li key={definition.id}>
                <strong dir="auto">{definition.name}</strong>
                {value ? (
                  <>
                    <span dir="auto">{String(value.value)}</span>
                    <small>
                      {value.writer} · {value.confidence}
                    </small>
                  </>
                ) : (
                  <em className="unknown-value">{text("Not set", "Ayarlanmadı", "تنظیم نشده")}</em>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <h4>{text("Notes", "Notlar", "یادداشت‌ها")}</h4>
      {notes.length === 0 ? (
        <Empty>{text("No notes yet.", "Henüz not yok.", "هنوز یادداشتی نیست.")}</Empty>
      ) : (
        <ul className="note-list">
          {notes.map((note) => (
            <li key={String(note.id)}>
              <p dir="auto">{String(note.body)}</p>
              <small>
                <time dateTime={String(note.created_at)}>
                  {when.format(new Date(String(note.created_at)))}
                </time>
              </small>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function OverviewSection({
  identities,
  contacts,
  consents
}: {
  identities: readonly Record<string, unknown>[];
  contacts: readonly Record<string, unknown>[];
  consents: readonly Record<string, unknown>[];
}) {
  const { text } = useI18n();
  return (
    <>
      <h4>{text("Contact methods", "İletişim yolları", "راه‌های تماس")}</h4>
      {contacts.length === 0 ? (
        <Empty>
          {text(
            "No phone or email is recorded.",
            "Kayıtlı telefon veya e-posta yok.",
            "شماره یا ایمیلی ثبت نشده است."
          )}
        </Empty>
      ) : (
        <ul className="contact-list">
          {contacts.map((contact) => (
            <li key={String(contact.id)}>
              <strong>{String(contact.kind ?? "")}</strong>
              {/* Isolated: a phone number or an address must not reorder itself
                  inside a right-to-left sentence. */}
              <bdi dir="auto">{String(contact.value ?? "")}</bdi>
            </li>
          ))}
        </ul>
      )}
      <h4>{text("Channels", "Kanallar", "کانال‌ها")}</h4>
      {identities.length === 0 ? (
        <Empty>
          {text(
            "This contact has not been matched to a channel identity.",
            "Bu kişi bir kanal kimliğiyle eşleşmedi.",
            "این مخاطب به هویت کانالی متصل نشده است."
          )}
        </Empty>
      ) : (
        <ul className="contact-list">
          {identities.map((identity) => (
            <li key={String(identity.id)}>
              <strong>{String(identity.channel)}</strong>
              <bdi dir="auto">{String(identity.username ?? identity.external_id ?? "")}</bdi>
            </li>
          ))}
        </ul>
      )}
      <h4>{text("Consent", "İzin", "رضایت")}</h4>
      {consents.length === 0 ? (
        <Empty>
          {text(
            "No consent record. Treat outbound as unconfirmed.",
            "İzin kaydı yok. Giden mesajları doğrulanmamış sayın.",
            "رکورد رضایتی نیست. ارسال خروجی را تأییدنشده در نظر بگیرید."
          )}
        </Empty>
      ) : (
        <ul className="contact-list">
          {consents.map((consent) => (
            <li key={String(consent.id)}>
              <strong>{String(consent.channel)}</strong>
              <span className="status-pill">
                {consent.opt_out
                  ? text("Opted out", "Vazgeçti", "انصراف داده")
                  : text("Allowed", "İzinli", "مجاز")}
              </span>
              <small>{String(consent.status ?? "")}</small>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
