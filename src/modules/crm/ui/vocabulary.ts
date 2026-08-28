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
