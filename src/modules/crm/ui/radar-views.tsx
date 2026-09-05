"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useI18n } from "@/src/lib/i18n/client";
import type { SavedView } from "../contracts";
import { RADAR_VIEW_KEYS, type RadarViewFilters, type RadarViewKey } from "../radar-views";
import { VIEW_LABELS } from "./vocabulary";

/**
 * The seven views, then the workspace's own.
 *
 * They are links rather than a control that filters in place, because a view is
 * a location: an operator sends "the follow-ups are piling up" with a URL, and
 * the back button means what it says.
 *
 * Saving one sends the filters currently in force, and the server stores them
 * as values in typed columns after checking each against the vocabulary it
 * belongs to. What is deliberately not saved is the search box - a saved view
 * holds a definition, and free text somebody typed is not one.
 */
export function RadarViewTabs({
  savedViews,
  activeKey,
  activeSavedViewId,
  filters,
  canManage
}: {
  savedViews: readonly SavedView[];
  activeKey: RadarViewKey | null;
  activeSavedViewId: string | null;
  /** What a save would store: the view in force, without the search text. */
  filters: RadarViewFilters;
  canManage: boolean;
}) {
  const { text } = useI18n();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (!name) return;
    setSaving(true);
    const response = await fetch("/api/crm/saved-views", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": await csrfToken() },
      body: JSON.stringify({ name, filters })
    });
    setSaving(false);
    if (response.ok) {
      form.reset();
      setMessage("");
      router.refresh();
      return;
    }
    setMessage(
      response.status === 409
        ? text(
            "A view with that name already exists.",
            "Bu adda bir görünüm zaten var.",
            "نمایی با این نام از قبل وجود دارد."
          )
        : text("This view could not be saved.", "Bu görünüm kaydedilemedi.", "این نما ذخیره نشد.")
    );
  }

  async function remove(view: SavedView) {
    setSaving(true);
    await fetch(`/api/crm/saved-views/${view.id}`, {
      method: "DELETE",
      headers: { "x-csrf-token": await csrfToken() }
    });
    setSaving(false);
    router.refresh();
  }

  const empty = Object.values(filters).every((value) => value === undefined);

  return (
    <nav className="radar-views" aria-label={text("Views", "Görünümler", "نماها")}>
      <ul>
        {RADAR_VIEW_KEYS.map((key) => (
          <li key={key}>
            <Link
              href={`/crm?view=${key}`}
              aria-current={key === activeKey && !activeSavedViewId ? "page" : undefined}
            >
              {text(...VIEW_LABELS[key])}
            </Link>
          </li>
        ))}
        {savedViews.map((view) => (
          <li key={view.id}>
            <Link
              href={`/crm?view=saved:${view.id}`}
              aria-current={view.id === activeSavedViewId ? "page" : undefined}
            >
              {view.name}
            </Link>
            {canManage ? (
              <button
                type="button"
                className="button-text"
                disabled={saving}
                onClick={() => void remove(view)}
                aria-label={`${text("Delete view", "Görünümü sil", "حذف نما")} ${view.name}`}
              >
                ×
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage && !empty ? (
        <form method="post" onSubmit={save}>
          <label>
            {text("Save this view as", "Bu görünümü şu adla kaydet", "ذخیره این نما با نام")}
            <input name="name" maxLength={60} required />
          </label>
          <button disabled={saving}>{text("Save view", "Görünümü kaydet", "ذخیره نما")}</button>
          {message ? <span role="status">{message}</span> : null}
        </form>
      ) : null}
    </nav>
  );
}

async function csrfToken() {
  return ((await fetch("/api/auth/csrf").then((response) => response.json())) as { token: string })
    .token;
}
