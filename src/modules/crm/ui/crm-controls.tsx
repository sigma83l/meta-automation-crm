"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

export function CrmControls() {
  const router = useRouter();
  const search = useSearchParams();
  const [loading, setLoading] = useState(false);

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
      if (download.url) window.location.assign(download.url);
    }
    setLoading(false);
  }

  return (
    <div className="crm-control-grid">
      <form className="crm-filter" onSubmit={filter}>
        <input
          name="q"
          placeholder="Search name or company"
          defaultValue={search.get("q") ?? ""}
          aria-label="Search customers"
        />
        <select
          name="status"
          defaultValue={search.get("status") ?? ""}
          aria-label="Customer status"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
        <button>Apply filters</button>
        <button type="button" onClick={() => exportView("filtered")} disabled={loading}>
          Export view
        </button>
        <button type="button" onClick={() => exportView("workspace")} disabled={loading}>
          Export all
        </button>
      </form>
      <form className="crm-create" onSubmit={create}>
        <strong>New customer</strong>
        <input name="displayName" placeholder="Display name" required />
        <input name="companyName" placeholder="Company" />
        <input name="email" type="email" placeholder="Email" />
        <button disabled={loading}>{loading ? "Working…" : "Create"}</button>
      </form>
    </div>
  );
}
