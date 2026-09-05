"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useI18n } from "@/src/lib/i18n/client";
import { navigateToSafeDownload } from "@/src/lib/safe-download";

export function CustomerActions({
  customerId,
  displayName,
  companyName
}: {
  customerId: string;
  displayName: string;
  companyName: string;
}) {
  const { text } = useI18n();
  const router = useRouter();
  const [status, setStatus] = useState("");
  async function csrf() {
    return (await fetch("/api/auth/csrf").then((response) => response.json())) as {
      token: string;
    };
  }
  async function edit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/crm/customers/${customerId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": (await csrf()).token
      },
      body: JSON.stringify(Object.fromEntries(form))
    });
    setStatus(
      response.ok
        ? text("Customer saved.", "Müşteri kaydedildi.", "مشتری ذخیره شد.")
        : text("Customer could not be saved.", "Müşteri kaydedilemedi.", "مشتری ذخیره نشد.")
    );
    if (response.ok) router.refresh();
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set("customerId", customerId);
    const response = await fetch("/api/crm/media", {
      method: "POST",
      headers: { "x-csrf-token": (await csrf()).token },
      body: form
    });
    setStatus(
      response.ok
        ? text("Private file uploaded.", "Özel dosya yüklendi.", "فایل خصوصی بارگذاری شد.")
        : text(
            "File rejected by media policy.",
            "Dosya medya politikası tarafından reddedildi.",
            "فایل با سیاست رسانه رد شد."
          )
    );
    if (response.ok) router.refresh();
  }
  async function exportOne() {
    const response = await fetch("/api/crm/exports", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": (await csrf()).token
      },
      body: JSON.stringify({ kind: "one", customerId })
    });
    if (response.ok) {
      const { jobId } = (await response.json()) as { jobId: string };
      const result = (await fetch(`/api/crm/exports/${jobId}`).then((item) => item.json())) as {
        url?: string;
      };
      if (result.url && !navigateToSafeDownload(result.url)) {
        setStatus(
          text(
            "Unsafe download blocked.",
            "Güvensiz indirme engellendi.",
            "بارگیری ناامن مسدود شد."
          )
        );
      }
    }
  }
  return (
    <div className="customer-actions">
      <form method="post" onSubmit={edit}>
        <input
          name="displayName"
          defaultValue={displayName}
          required
          aria-label={text("Edit display name", "Görünen adı düzenle", "ویرایش نام نمایشی")}
        />
        <input
          name="companyName"
          defaultValue={companyName}
          aria-label={text("Edit company name", "Şirket adını düzenle", "ویرایش نام شرکت")}
        />
        <button>{text("Save customer", "Müşteriyi kaydet", "ذخیره مشتری")}</button>
      </form>
      <form method="post" onSubmit={upload}>
        <input
          name="file"
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.pdf"
          required
          aria-label={text("Customer file", "Müşteri dosyası", "فایل مشتری")}
        />
        <button>{text("Upload private file", "Özel dosya yükle", "بارگذاری فایل خصوصی")}</button>
      </form>
      <button onClick={exportOne}>
        {text("Export customer", "Müşteriyi dışa aktar", "خروجی مشتری")}
      </button>
      {status ? <span role="status">{status}</span> : null}
    </div>
  );
}
