"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/src/lib/i18n/client";
import { navigateToSafeDownload } from "@/src/lib/safe-download";
import type { RadarRow } from "../contracts";
import {
  CONFIDENCE_LABELS,
  LEAD_STATUS_LABELS,
  LIFECYCLE_LABELS,
  NEXT_ACTION_LABELS,
  PRIORITY_LABELS
} from "./vocabulary";

/**
 * The customer radar.
 *
 * The simple table stayed - same grid, same table semantics, same selection and
 * export - and gained the columns `13_RECORD_LIST_AND_RADAR_UX.md` asks for.
 * Replacing it with a grid library would have cost the keyboard behaviour and
 * the RTL layout that already work, to display eight columns.
 *
 * Two rules from the pack are load-bearing here. Priority is never colour
 * alone: every chip carries its word, because an operator who cannot see the
 * red one still has to be able to sort out their morning. And an unknown says
 * so - a blank Current need cell would read as "nothing to know" rather than
 * "nobody has found out".
 */
export function CustomerTable({
  rows,
  currentUserId,
  nextPageHref,
  firstPageHref
}: {
  rows: readonly RadarRow[];
  currentUserId: string;
  /** Where the next page starts, or null when this is the end of the list. */
  nextPageHref: string | null;
  /** Set only while a cursor is in play, so paging back is one click. */
  firstPageHref: string | null;
}) {
  const { t, text, locale } = useI18n();
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
      if (result.url) navigateToSafeDownload(result.url);
    }
    setExporting(false);
  }

  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <section className="crm-table-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{t("crm.customers")}</span>
          <h2>
            {rows.length} {text("records", "kayıt", "رکورد")}
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
          <span role="columnheader">{text("Select", "Seç", "انتخاب")}</span>
          <span role="columnheader">{text("Customer", "Müşteri", "مشتری")}</span>
          <span role="columnheader">{text("Current need", "Güncel ihtiyaç", "نیاز فعلی")}</span>
          <span role="columnheader">{text("Lifecycle", "Yaşam döngüsü", "چرخه عمر")}</span>
          <span role="columnheader">{text("Status", "Durum", "وضعیت")}</span>
          <span role="columnheader">{text("Score", "Puan", "امتیاز")}</span>
          <span role="columnheader">{text("Next action", "Sonraki adım", "اقدام بعدی")}</span>
          <span role="columnheader">{text("Owner", "Sorumlu", "مسئول")}</span>
          <span role="columnheader">{text("Last activity", "Son hareket", "آخرین فعالیت")}</span>
        </div>
        {rows.map((row) => (
          <div className="crm-row" role="row" key={row.customerId}>
            <span role="cell">
              <input
                type="checkbox"
                aria-label={`${text("Select", "Seç", "انتخاب")} ${row.displayName}`}
                checked={selected.includes(row.customerId)}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? [...selected, row.customerId]
                      : selected.filter((id) => id !== row.customerId)
                  )
                }
              />
            </span>
            <span role="cell">
              <Link href={`/crm/${row.customerId}`}>{row.displayName}</Link>
              {row.companyName ? <small>{row.companyName}</small> : null}
            </span>
            <span role="cell">
              {row.currentNeed ? (
                <>
                  {row.currentNeed}
                  {row.currentNeedConfidence ? (
                    <small>{text(...CONFIDENCE_LABELS[row.currentNeedConfidence])}</small>
                  ) : null}
                </>
              ) : (
                <em className="unknown-value">
                  {text(
                    "Unknown — needs confirmation",
                    "Bilinmiyor — doğrulanmalı",
                    "نامشخص — نیاز به تأیید"
                  )}
                </em>
              )}
            </span>
            <span role="cell">
              <span className="status-pill">{text(...LIFECYCLE_LABELS[row.lifecycleStage])}</span>
            </span>
            <span role="cell">
              <span className="status-pill">{text(...LEAD_STATUS_LABELS[row.leadStatus])}</span>
            </span>
            <span role="cell">
              {row.score === null ? (
                <em className="unknown-value">{text("Not scored", "Puansız", "بدون امتیاز")}</em>
              ) : (
                row.score
              )}
            </span>
            <span role="cell">
              {text(...NEXT_ACTION_LABELS[row.nextAction.type])}
              <small className="priority-chip" data-priority={row.priority}>
                {text(...PRIORITY_LABELS[row.priority])}
              </small>
            </span>
            <span role="cell">
              {row.ownerId === null ? (
                <em className="unknown-value">{text("Unassigned", "Atanmamış", "بدون مسئول")}</em>
              ) : row.ownerId === currentUserId ? (
                text("You", "Siz", "شما")
              ) : (
                text("A teammate", "Bir ekip üyesi", "یکی از هم‌تیمی‌ها")
              )}
            </span>
            <span role="cell">
              <time dateTime={row.lastActivityAt}>{day.format(new Date(row.lastActivityAt))}</time>
            </span>
          </div>
        ))}
        {rows.length === 0 ? (
          <div className="empty-guidance">
            <strong>{t("crm.none")}</strong>
            <span>{t("crm.noneDetail")}</span>
          </div>
        ) : null}
      </div>
      {nextPageHref || firstPageHref ? (
        <nav className="crm-pager" aria-label={text("Pages", "Sayfalar", "صفحه‌ها")}>
          {firstPageHref ? (
            <Link href={firstPageHref}>{text("First page", "İlk sayfa", "صفحه اول")}</Link>
          ) : null}
          {nextPageHref ? (
            <Link href={nextPageHref}>{text("Next page", "Sonraki sayfa", "صفحه بعد")}</Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
