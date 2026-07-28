"use client";

import Link from "next/link";
import { useState } from "react";
import type { CustomerSummary } from "../contracts";

export function CustomerTable({ customers }: { customers: readonly CustomerSummary[] }) {
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
          <span className="eyebrow">Customers</span>
          <h2>{customers.length} records</h2>
        </div>
        <div>
          <span>{selected.length} selected</span>
          {selected.length ? (
            <button onClick={exportSelected} disabled={exporting}>
              {exporting ? "Preparing…" : "Export selected"}
            </button>
          ) : null}
        </div>
      </div>
      <div className="crm-table" role="table">
        <div className="crm-row crm-header" role="row">
          <span>Select</span>
          <span>Customer</span>
          <span>Company</span>
          <span>Status</span>
          <span>Source</span>
        </div>
        {customers.map((customer) => (
          <div className="crm-row" role="row" key={customer.id}>
            <input
              type="checkbox"
              aria-label={`Select ${customer.displayName}`}
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
            <strong>No customers match this view.</strong>
            <span>Create one or adjust the filters.</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
