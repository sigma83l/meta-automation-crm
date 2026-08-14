import Link from "next/link";
import type { Locale } from "@/src/lib/i18n/config";
import type { SubscriptionStatus } from "../contracts";

function localized(locale: Locale, english: string, turkish: string, persian: string) {
  return locale === "tr" ? turkish : locale === "fa" ? persian : english;
}

function statusCopy(locale: Locale, status: SubscriptionStatus) {
  if (status === "past_due") {
    return localized(
      locale,
      "Your last payment failed. Update your payment method to keep using this workspace.",
      "Son ödemeniz başarısız oldu. Bu çalışma alanını kullanmaya devam etmek için ödeme yönteminizi güncelleyin.",
      "آخرین پرداخت شما ناموفق بود. برای ادامه استفاده از این فضای کاری، روش پرداخت را به‌روزرسانی کنید."
    );
  }
  if (status === "canceled") {
    return localized(
      locale,
      "This workspace's subscription was canceled. Reactivate it to continue.",
      "Bu çalışma alanının aboneliği iptal edildi. Devam etmek için yeniden etkinleştirin.",
      "اشتراک این فضای کاری لغو شده است. برای ادامه آن را دوباره فعال کنید."
    );
  }
  if (status === "trialing") {
    return localized(
      locale,
      "Your free trial has ended. Add a payment method to keep using this workspace.",
      "Ücretsiz deneme süreniz sona erdi. Bu çalışma alanını kullanmaya devam etmek için ödeme yöntemi ekleyin.",
      "دوره آزمایشی رایگان شما به پایان رسید. برای ادامه استفاده، روش پرداخت اضافه کنید."
    );
  }
  return localized(
    locale,
    "Add a payment method to start your 7-day free trial.",
    "7 günlük ücretsiz denemenizi başlatmak için bir ödeme yöntemi ekleyin.",
    "برای شروع دوره آزمایشی رایگان ۷ روزه، یک روش پرداخت اضافه کنید."
  );
}

export function EntitlementBlocked({
  locale,
  status
}: {
  locale: Locale;
  status: SubscriptionStatus;
}) {
  return (
    <section className="settings-card" role="status">
      <h2>{localized(locale, "Subscription required", "Abonelik gerekli", "اشتراک لازم است")}</h2>
      <p>{statusCopy(locale, status)}</p>
      <Link href="/settings/billing" className="btn btn-primary">
        {localized(locale, "Go to billing", "Faturalandırmaya git", "رفتن به صورتحساب")}
      </Link>
    </section>
  );
}
