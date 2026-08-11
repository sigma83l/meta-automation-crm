"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useI18n } from "@/src/lib/i18n/client";
import { navigateToSafeDownload } from "@/src/lib/safe-download";

export function CrmControls() {
  const { text } = useI18n();
  const router = useRouter();
  const search = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [importMessage, setImportMessage] = useState("");

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    const query = String(form.get("q") ?? "");
    const status = String(form.get("status") ?? "");
    if (query) params.set("q", query);
    if (status) params.set("status", status);
    router.push(`/crm?${params}`);
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setLoading(true);
    const form = new FormData(formElement);
    const csrf = (await fetch("/api/auth/csrf").then((response) => response.json())) as {
      token: string;
    };
    const response = await fetch("/api/crm/customers", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf.token },
      body: JSON.stringify(Object.fromEntries(form))
    });
    setLoading(false);
    if (response.ok) {
      formElement.reset();
      router.refresh();
    }
  }

  async function exportView(kind: "filtered" | "workspace") {
    setLoading(true);
    const csrf = (await fetch("/api/auth/csrf").then((response) => response.json())) as {
      token: string;
    };
    const response = await fetch("/api/crm/exports", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf.token },
      body: JSON.stringify(
        kind === "workspace"
          ? { kind }
          : {
              kind,
              ...(search.get("q") ? { query: search.get("q") } : {}),
              ...(search.get("status") ? { status: search.get("status") } : {})
            }
      )
    });
    if (response.ok) {
      const { jobId } = (await response.json()) as { jobId: string };
      const download = (await fetch(`/api/crm/exports/${jobId}`).then((result) =>
        result.json()
      )) as { url?: string };
      if (download.url) navigateToSafeDownload(download.url);
    }
    setLoading(false);
  }

  async function importCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("csv");
    if (!(file instanceof File) || file.size > 1_048_576 || !file.name.endsWith(".csv")) {
      setImportMessage(
        text(
          "Choose a CSV file no larger than 1 MB.",
          "1 MB'den küçük bir CSV dosyası seçin.",
          "یک فایل CSV کوچک‌تر از ۱ مگابایت انتخاب کنید."
        )
      );
      return;
    }
    setLoading(true);
    const token = await csrfToken();
    const response = await fetch("/api/crm/imports", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": token },
      body: JSON.stringify({ sourceName: file.name, csv: await file.text() })
    });
    const result = (await response.json()) as { acceptedRows?: number };
    setLoading(false);
    setImportMessage(
      response.ok
        ? `${result.acceptedRows ?? 0} ${text("customers imported.", "müşteri içe aktarıldı.", "مشتری وارد شد.")}`
        : text(
            "Import rejected. Check the CSV headers and values.",
            "İçe aktarma reddedildi. Başlıkları ve değerleri kontrol edin.",
            "ورود داده رد شد. عنوان ستون‌ها و مقادیر را بررسی کنید."
          )
    );
    if (response.ok) router.refresh();
  }

  return (
    <div className="crm-control-grid">
      <form className="crm-filter" onSubmit={filter}>
        <input
          name="q"
          placeholder={text("Search name or company", "Ad veya şirket ara", "جستجوی نام یا شرکت")}
          defaultValue={search.get("q") ?? ""}
          aria-label={text("Search customers", "Müşteri ara", "جستجوی مشتری")}
        />
        <select
          name="status"
          defaultValue={search.get("status") ?? ""}
          aria-label={text("Customer status", "Müşteri durumu", "وضعیت مشتری")}
        >
          <option value="">{text("All statuses", "Tüm durumlar", "همه وضعیت‌ها")}</option>
          <option value="active">{text("Active", "Etkin", "فعال")}</option>
          <option value="archived">{text("Archived", "Arşivlenmiş", "بایگانی")}</option>
        </select>
        <button>{text("Apply filters", "Filtreleri uygula", "اعمال فیلتر")}</button>
        <button type="button" onClick={() => exportView("filtered")} disabled={loading}>
          {text("Export view", "Görünümü dışa aktar", "خروجی این نما")}
        </button>
        <button type="button" onClick={() => exportView("workspace")} disabled={loading}>
          {text("Export all", "Tümünü dışa aktar", "خروجی همه")}
        </button>
      </form>
      <form className="crm-create" onSubmit={create}>
        <strong>{text("New customer", "Yeni müşteri", "مشتری جدید")}</strong>
        <input
          name="displayName"
          placeholder={text("Display name", "Görünen ad", "نام نمایشی")}
          required
        />
        <input name="companyName" placeholder={text("Company", "Şirket", "شرکت")} />
        <input name="email" type="email" placeholder={text("Email", "E-posta", "ایمیل")} />
        <button disabled={loading}>
          {loading
            ? text("Working…", "İşleniyor…", "در حال انجام…")
            : text("Create", "Oluştur", "ساخت")}
        </button>
      </form>
      <form className="crm-create" onSubmit={importCsv}>
        <strong>{text("Import CSV", "CSV içe aktar", "ورود CSV")}</strong>
        <p>
          {text(
            "Headers: display name, company, email, phone. Maximum 500 rows / 1 MB.",
            "Başlıklar: görünen ad, şirket, e-posta, telefon. En çok 500 satır / 1 MB.",
            "ستون‌ها: نام نمایشی، شرکت، ایمیل، تلفن. حداکثر ۵۰۰ ردیف / ۱ مگابایت."
          )}
        </p>
        <label>
          {text("Customer CSV file", "Müşteri CSV dosyası", "فایل CSV مشتری")}
          <input name="csv" type="file" accept=".csv,text/csv" required />
        </label>
        <button disabled={loading}>
          {loading
            ? text("Working…", "İşleniyor…", "در حال انجام…")
            : text("Import customers", "Müşterileri içe aktar", "ورود مشتریان")}
        </button>
        {importMessage ? <span role="status">{importMessage}</span> : null}
      </form>
    </div>
  );
}

async function csrfToken() {
  return ((await fetch("/api/auth/csrf").then((response) => response.json())) as { token: string })
    .token;
}
