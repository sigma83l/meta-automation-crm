/**
 * The CRM's vocabularies, in the three languages the product ships.
 *
 * These are enum values an operator reads all day - a lifecycle stage, what a
 * conversation is waiting on, what to do next - and until now nothing displayed
 * them at all. Rendering the raw value would have shipped `sales_ready` and
 * `follow_up_due` to a Turkish or Persian operator, which is how en/tr/fa
 * parity is lost one column at a time.
 *
 * Each entry is the tuple `useI18n().text` takes, so a caller writes
 * `text(...LIFECYCLE_LABELS[stage])` and cannot silently omit a language: a new
 * member of any of these unions fails to compile until all three exist.
 */

import type { AttentionPriority } from "../attention-priority";
import type { DueState } from "../now-card";
import type { TimelineActor, TimelineCategory, TimelineKind } from "../timeline";
import type { NextActionType } from "../next-action";
import type { RadarViewKey } from "../radar-views";
import type { LeadStatus, LifecycleStage } from "../revenue-state";
import type { FactConfidence } from "@/src/modules/rcos/memory-policy";

/** English, Turkish, Persian - the order `text()` expects. */
export type Labels = readonly [string, string, string];

export const LIFECYCLE_LABELS: Readonly<Record<LifecycleStage, Labels>> = {
  new: ["New", "Yeni", "جدید"],
  engaged: ["Engaged", "İletişimde", "در تعامل"],
  qualified: ["Qualified", "Nitelikli", "واجد شرایط"],
  sales_ready: ["Sales-ready", "Satışa hazır", "آماده فروش"],
  opportunity: ["Opportunity", "Fırsat", "فرصت"],
  customer: ["Customer", "Müşteri", "مشتری"],
  retention: ["Retention", "Elde tutma", "نگهداشت"]
};

export const LEAD_STATUS_LABELS: Readonly<Record<LeadStatus, Labels>> = {
  needs_reply: ["Needs reply", "Yanıt bekliyor", "نیازمند پاسخ"],
  awaiting_customer: ["Awaiting customer", "Müşteri bekleniyor", "در انتظار مشتری"],
  follow_up_due: ["Follow-up due", "Takip zamanı", "زمان پیگیری"],
  human_review: ["Human review", "İnsan incelemesi", "بررسی انسانی"],
  booked: ["Booked", "Randevulu", "رزرو شده"],
  payment_pending: ["Payment pending", "Ödeme bekliyor", "در انتظار پرداخت"],
  closed: ["Closed", "Kapalı", "بسته"]
};

export const NEXT_ACTION_LABELS: Readonly<Record<NextActionType, Labels>> = {
  reply: ["Reply", "Yanıtla", "پاسخ بده"],
  clarify: ["Clarify", "Netleştir", "شفاف‌سازی کن"],
  qualify: ["Qualify", "Nitele", "ارزیابی کن"],
  task: ["Task", "Görev", "وظیفه"],
  follow_up: ["Follow up", "Takip et", "پیگیری کن"],
  assign: ["Assign", "Ata", "تخصیص بده"],
  handoff: ["Hand off", "Devret", "واگذار کن"],
  booking: ["Booking", "Randevu", "رزرو"],
  wait: ["Wait", "Bekle", "منتظر بمان"],
  close: ["Close", "Kapat", "ببند"]
};

export const PRIORITY_LABELS: Readonly<Record<AttentionPriority, Labels>> = {
  critical: ["Critical", "Kritik", "بحرانی"],
  high: ["High", "Yüksek", "بالا"],
  normal: ["Normal", "Normal", "عادی"],
  low: ["Low", "Düşük", "پایین"]
};

/**
 * How firm a remembered fact is. Shown beside the need itself, because a model's
 * inference and something the customer stated read identically otherwise.
 */
export const CONFIDENCE_LABELS: Readonly<Record<FactConfidence, Labels>> = {
  inferred: ["Inferred", "Çıkarım", "استنباط‌شده"],
  high_confidence: ["High confidence", "Yüksek güven", "اطمینان بالا"],
  confirmed: ["Confirmed", "Doğrulandı", "تأییدشده"],
  human_verified: ["Human-verified", "İnsan doğruladı", "تأیید انسانی"]
};

export const VIEW_LABELS: Readonly<Record<RadarViewKey, Labels>> = {
  needs_attention: ["Needs attention", "Dikkat gerekiyor", "نیازمند توجه"],
  all_customers: ["All customers", "Tüm müşteriler", "همه مشتریان"],
  follow_up_due: ["Follow-up due", "Takip zamanı", "زمان پیگیری"],
  qualified: ["Qualified", "Nitelikli", "واجد شرایط"],
  sales_ready: ["Sales-ready", "Satışa hazır", "آماده فروش"],
  customers: ["Customers", "Müşteriler", "مشتریان"],
  recently_active: ["Recently active", "Son hareketler", "فعال اخیر"]
};

/** The record's sections, in the order `02_CRM_INFORMATION_ARCHITECTURE.md` lists them. */
export const RECORD_SECTIONS = [
  "overview",
  "timeline",
  "conversations",
  "memory",
  "followup",
  "automations",
  "files",
  "fields",
  "audit"
] as const;
export type RecordSection = (typeof RECORD_SECTIONS)[number];

export const SECTION_LABELS: Readonly<Record<RecordSection, Labels>> = {
  overview: ["Overview", "Genel bakış", "نمای کلی"],
  timeline: ["Timeline", "Zaman çizelgesi", "خط زمانی"],
  conversations: ["Conversations", "Konuşmalar", "گفتگوها"],
  memory: ["Memory", "Hafıza", "حافظه"],
  followup: ["Follow-up", "Takip", "پیگیری"],
  automations: ["Automations", "Otomasyonlar", "اتوماسیون‌ها"],
  files: ["Files", "Dosyalar", "فایل‌ها"],
  fields: ["Fields & Notes", "Alanlar ve notlar", "فیلدها و یادداشت‌ها"],
  audit: ["Audit", "Denetim", "ممیزی"]
};

export const DUE_STATE_LABELS: Readonly<Record<DueState, Labels>> = {
  overdue: ["Overdue", "Gecikmiş", "عقب‌افتاده"],
  due_soon: ["Due soon", "Yakında", "به‌زودی"],
  scheduled: ["Scheduled", "Planlandı", "زمان‌بندی‌شده"],
  none: ["Nothing due", "Bekleyen yok", "چیزی در انتظار نیست"]
};

export const TIMELINE_CATEGORY_LABELS: Readonly<Record<TimelineCategory, Labels>> = {
  messages: ["Messages", "Mesajlar", "پیام‌ها"],
  crm_changes: ["CRM changes", "CRM değişiklikleri", "تغییرات CRM"],
  ai_automation: ["AI & automation", "Yapay zekâ ve otomasyon", "هوش مصنوعی و اتوماسیون"],
  tasks: ["Tasks", "Görevler", "وظایف"],
  outcomes: ["Outcomes", "Sonuçlar", "نتایج"],
  admin: ["Admin", "Yönetim", "مدیریت"]
};

export const TIMELINE_ACTOR_LABELS: Readonly<Record<TimelineActor, Labels>> = {
  customer: ["Customer", "Müşteri", "مشتری"],
  // Not a person: `messages` records that it went out from here, not who sent it.
  workspace: ["This workspace", "Bu çalışma alanı", "این فضای کاری"],
  operator: ["A teammate", "Bir ekip üyesi", "یکی از هم‌تیمی‌ها"],
  automation: ["Automation", "Otomasyon", "اتوماسیون"],
  system: ["System", "Sistem", "سامانه"]
};

/**
 * What happened, phrased where the reader's language is known.
 *
 * The timeline carries a kind and the values a phrasing needs; this is the
 * phrasing. Values from the event's `detail` are placed by the caller, so these
 * stay sentences rather than templates a translator cannot reorder.
 */
export const TIMELINE_KIND_LABELS: Readonly<Record<TimelineKind, Labels>> = {
  message_inbound: ["Message received", "Mesaj alındı", "پیام دریافت شد"],
  message_outbound: ["Message sent", "Mesaj gönderildi", "پیام ارسال شد"],
  note_added: ["Note added", "Not eklendi", "یادداشت افزوده شد"],
  record_activity: ["Record updated", "Kayıt güncellendi", "رکورد به‌روزرسانی شد"],
  stage_changed: ["Lifecycle stage changed", "Yaşam döngüsü değişti", "مرحله چرخه عمر تغییر کرد"],
  score_changed: [
    "Qualification score recalculated",
    "Puan yeniden hesaplandı",
    "امتیاز دوباره محاسبه شد"
  ],
  followup_scheduled: ["Follow-up scheduled", "Takip planlandı", "پیگیری زمان‌بندی شد"],
  followup_settled: ["Follow-up closed", "Takip kapandı", "پیگیری بسته شد"],
  opportunity_opened: ["Opportunity opened", "Fırsat açıldı", "فرصت باز شد"],
  opportunity_settled: ["Opportunity settled", "Fırsat sonuçlandı", "فرصت نهایی شد"],
  handoff_raised: ["Handed to a person", "Bir kişiye devredildi", "به یک نفر واگذار شد"],
  automation_linked: ["Automation linked", "Otomasyon bağlandı", "اتوماسیون متصل شد"],
  audit_action: ["Audit entry", "Denetim kaydı", "رکورد ممیزی"]
};
