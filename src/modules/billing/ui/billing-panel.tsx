"use client";
import { useState } from "react";
import { useI18n } from "@/src/lib/i18n/client";
import type { BillingStatus } from "../contracts";

type TextFn = (english: string, turkish: string, persian: string) => string;

async function csrf() {
  return (
    (await fetch("/api/auth/csrf").then((response) => response.json())) as {
      token: string;
    }
  ).token;
}

function statusLabel(status: BillingStatus["status"], daysLeft: number | null, text: TextFn) {
  if (status === "trialing" && daysLeft !== null) {
    return text(
      `Trial — ${daysLeft} day(s) left`,
      `Deneme — ${daysLeft} gün kaldı`,
      `آزمایشی — ${daysLeft} روز باقی‌مانده`
    );
  }
  if (status === "active") return text("Active", "Aktif", "فعال");
  if (status === "past_due") return text("Payment past due", "Ödeme gecikti", "پرداخت معوق");
  if (status === "canceled") return text("Canceled", "İptal edildi", "لغو شده");
  return text(
    "Incomplete — add a payment method",
    "Eksik — ödeme yöntemi ekleyin",
    "ناقص — روش پرداخت اضافه کنید"
  );
}

function callbackMessage(callbackStatus: string | null, text: TextFn): string {
  switch (callbackStatus) {
    case "trialing":
      return text(
        "Your 7-day trial has started.",
        "7 günlük denemeniz başladı.",
        "دوره آزمایشی ۷ روزه شما آغاز شد."
      );
    case "active":
      return text(
        "Payment succeeded — your subscription is active.",
        "Ödeme başarılı — aboneliğiniz aktif.",
        "پرداخت موفق بود — اشتراک شما فعال است."
      );
    case "payment_required":
      return text(
        "The card was declined. Try a different card.",
        "Kart reddedildi. Başka bir kart deneyin.",
        "کارت رد شد. کارت دیگری را امتحان کنید."
      );
    case "invalid_state":
    case "error":
      return text(
        "Something went wrong. Please try again.",
        "Bir sorun oluştu. Lütfen tekrar deneyin.",
        "خطایی رخ داد. لطفاً دوباره امتحان کنید."
      );
    default:
      return "";
  }
}

export function BillingPanel({
  billing,
  callbackStatus
}: {
  billing: BillingStatus;
  callbackStatus: string | null;
}) {
  const { text } = useI18n();
  const [message, setMessage] = useState(() => callbackMessage(callbackStatus, text));
  const [pending, setPending] = useState(false);

  async function addOrUpdateCard() {
    setPending(true);
    try {
      const response = await fetch("/api/billing/start", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": await csrf() }
      });
      if (!response.ok) throw new Error("start failed");
      const { redirectUrl } = (await response.json()) as { redirectUrl: string };
      location.assign(redirectUrl);
    } catch {
      setMessage(
        text(
          "Could not start card registration.",
          "Kart kaydı başlatılamadı.",
          "ثبت کارت آغاز نشد."
        )
      );
      setPending(false);
    }
  }

  async function cancel() {
    setPending(true);
    try {
      const response = await fetch("/api/billing", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": await csrf() }
      });
      if (!response.ok) throw new Error("cancel failed");
      location.reload();
    } catch {
      setMessage(text("Cancellation failed.", "İptal başarısız oldu.", "لغو ناموفق بود."));
      setPending(false);
    }
  }

  const canCancel =
    billing.status === "active" || billing.status === "trialing" || billing.status === "past_due";

  return (
    <div className="settings-stack">
      {message && (
        <p className="form-status" role="status">
          {message}
        </p>
      )}
      <section className="settings-card" id="billing">
        <h2>{text("Billing & subscription", "Faturalandırma ve abonelik", "صورتحساب و اشتراک")}</h2>
        <p>
          {billing.planDisplayName} — {(billing.priceMinorUnits / 100).toFixed(2)}{" "}
          {billing.currency}
          {text(" / month", " / ay", " / ماه")}
        </p>
        <p>
          <strong>{text("Status", "Durum", "وضعیت")}:</strong>{" "}
          {statusLabel(billing.status, billing.trialDaysLeft, text)}
        </p>
        {billing.paymentMethod ? (
          <p>
            {text("Card on file", "Kayıtlı kart", "کارت ثبت‌شده")}: ••••
            {billing.paymentMethod.maskedCardSuffix}
            {billing.paymentMethod.cardBrand ? ` (${billing.paymentMethod.cardBrand})` : ""}
          </p>
        ) : (
          <p>
            {text(
              "No payment method on file yet.",
              "Kayıtlı bir ödeme yöntemi yok.",
              "هنوز روش پرداختی ثبت نشده است."
            )}
          </p>
        )}
        <div className="settings-management-grid">
          <button type="button" disabled={pending} onClick={addOrUpdateCard}>
            {billing.paymentMethod
              ? text("Update payment method", "Ödeme yöntemini güncelle", "بروزرسانی روش پرداخت")
              : text(
                  "Add payment method to start trial",
                  "Denemeyi başlatmak için ödeme yöntemi ekle",
                  "برای شروع آزمایشی روش پرداخت اضافه کنید"
                )}
          </button>
          {canCancel ? (
            <button type="button" className="button-muted" disabled={pending} onClick={cancel}>
              {text("Cancel subscription", "Aboneliği iptal et", "لغو اشتراک")}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
