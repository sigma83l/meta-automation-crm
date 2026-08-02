"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/src/lib/i18n/client";
import type { CustomerSummary } from "../contracts";

export function CustomerTable({ customers }: { customers: readonly CustomerSummary[] }) {
  const { t, text } = useI18n();
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [exporting, setExporting] = useState(false);

  async function exportSelected() {
    setExporting(true);
    const csrf = (await fetch("/api/auth/csrf").then((response) => response.json())) as {
      token: string;
    };
    const created = await fetch("/api/crm/exports", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf.token },
      body: JSON.stringify({ kind: "selected", customerIds: selected })
    });
    if (created.ok) {
      const { jobId } = (await created.json()) as { jobId: string };
      const result = (await fetch(`/api/crm/exports/${jobId}`).then((response) =>
        response.json()
      )) as { url?: string };
      if (result.url) window.location.assign(result.url);
    }
    setExporting(false);
  }
  return (
    <section className="crm-table-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{t("crm.customers")}</span>
          <h2>
            {customers.length} {text("records", "kayıt", "رکورد")}
          </h2>
        </div>
        <div>
          <span>
            {selected.length} {text("selected", "seçili", "انتخاب‌شده")}
          </span>
          {selected.length ? (
            <button onClick={exportSelected} disabled={exporting}>
              {exporting
                ? text("Preparing…", "Hazırlanıyor…", "در حال آماده‌سازی…")
                : text("Export selected", "Seçilenleri dışa aktar", "خروجی موارد انتخابی")}
            </button>
          ) : null}
        </div>
      </div>
      <div className="crm-table" role="table">
        <div className="crm-row crm-header" role="row">
          <span>{text("Select", "Seç", "انتخاب")}</span>
          <span>{text("Customer", "Müşteri", "مشتری")}</span>
          <span>{text("Company", "Şirket", "شرکت")}</span>
          <span>{text("Status", "Durum", "وضعیت")}</span>
          <span>{text("Source", "Kaynak", "منبع")}</span>
        </div>
        {customers.map((customer) => (
          <div className="crm-row" role="row" key={customer.id}>
            <input
              type="checkbox"
              aria-label={`${text("Select", "Seç", "انتخاب")} ${customer.displayName}`}
              checked={selected.includes(customer.id)}
              onChange={(event) =>
                setSelected(
                  event.target.checked
                    ? [...selected, customer.id]
                    : selected.filter((id) => id !== customer.id)
                )
              }
            />
            <Link href={`/crm/${customer.id}`}>{customer.displayName}</Link>
            <span>{customer.companyName ?? "—"}</span>
            <span className="status-pill">{customer.status}</span>
            <span>{customer.source}</span>
          </div>
        ))}
        {customers.length === 0 ? (
          <div className="empty-guidance">
            <strong>{t("crm.none")}</strong>
            <span>{t("crm.noneDetail")}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
