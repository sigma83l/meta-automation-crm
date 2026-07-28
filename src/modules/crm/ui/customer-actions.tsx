"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function CustomerActions({
  customerId,
  displayName,
  companyName
}: {
  customerId: string;
  displayName: string;
  companyName: string;
}) {
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
    setStatus(response.ok ? "Customer saved." : "Customer could not be saved.");
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
    setStatus(response.ok ? "Private file uploaded." : "File rejected by media policy.");
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
      if (result.url) window.location.assign(result.url);
    }
  }
  return (
    <div className="customer-actions">
      <form onSubmit={edit}>
        <input
          name="displayName"
          defaultValue={displayName}
          required
          aria-label="Edit display name"
        />
        <input name="companyName" defaultValue={companyName} aria-label="Edit company name" />
        <button>Save customer</button>
      </form>
      <form onSubmit={upload}>
        <input
          name="file"
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.pdf"
          required
          aria-label="Customer file"
        />
        <button>Upload private file</button>
      </form>
      <button onClick={exportOne}>Export customer</button>
      {status ? <span role="status">{status}</span> : null}
    </div>
  );
}
