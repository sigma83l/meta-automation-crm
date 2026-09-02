"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useI18n } from "@/src/lib/i18n/client";

import { adminAction } from "./admin-client";

/**
 * An extra input an action needs beyond its reason: a day count, a role, a plan.
 *
 * Declared as data rather than passed as a render prop, so every prop of this
 * component stays serializable and a server component can hand it a spec
 * directly. It also keeps the action's whole shape visible at the call site
 * instead of hidden inside a closure.
 */
export type ActionField = Readonly<{
  key: string;
  label: string;
  kind: "text" | "number" | "select";
  defaultValue?: string;
  options?: ReadonlyArray<Readonly<{ value: string; label: string }>>;
  min?: number;
  max?: number;
}>;

/**
 * The console's only mutation control.
 *
 * Every action here changes somebody else's account, so every action asks for a
 * reason before it will submit — the same requirement the server enforces and
 * the audit ledger stores. Making that one component rather than a convention
 * is the point: an action added later cannot forget the reason box, because
 * there is no other way to post.
 *
 * `confirmLabel` arms the irreversible-feeling ones (suspension, revocation) so
 * they take two deliberate presses. Not a modal: the row stays on screen, so
 * the person can re-read which account they are about to act on.
 */
export function ReasonAction({
  endpoint,
  body,
  label,
  confirmLabel,
  variant = "default",
  fields = []
}: {
  endpoint: string;
  body: Record<string, unknown>;
  label: string;
  confirmLabel?: string;
  variant?: "default" | "danger";
  fields?: readonly ActionField[];
}) {
  const { text } = useI18n();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, field.defaultValue ?? ""]))
  );
  const [armed, setArmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const id = `${endpoint}-${label}`.replace(/[^a-zA-Z0-9]+/g, "-");

  const submit = async () => {
    if (reason.trim().length < 3) {
      setMessage(
        text(
          "Give a reason of at least 3 characters.",
          "En az 3 karakterlik bir gerekçe girin.",
          "دلیلی با حداقل ۳ نویسه بنویسید."
        )
      );
      return;
    }
    if (confirmLabel && !armed) {
      setArmed(true);
      setMessage(null);
      return;
    }
    setWorking(true);
    setMessage(null);
    // Numbers travel as numbers: the routes validate with Number.isInteger, and
    // a numeric field arriving as "7" would be refused as not a whole number.
    const typed: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = values[field.key] ?? "";
      if (raw === "") continue;
      typed[field.key] = field.kind === "number" ? Number(raw) : raw;
    }
    const result = await adminAction(endpoint, { ...body, ...typed, reason: reason.trim() });
    setWorking(false);
    setArmed(false);
    if (result.ok) {
      setReason("");
      // The server rendered this row; re-ask it rather than patching local state,
      // so what is on screen after the action is what the database actually says.
      router.refresh();
      return;
    }
    setMessage(result.message ?? null);
  };

  return (
    <div className="admin-action">
      {fields.map((field) => (
        <span className="admin-action-field" key={field.key}>
          <label className="sr-only" htmlFor={`${id}-${field.key}`}>
            {field.label}
          </label>
          {field.kind === "select" ? (
            <select
              id={`${id}-${field.key}`}
              value={values[field.key] ?? ""}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.key]: event.target.value }))
              }
            >
              {(field.options ?? []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : field.kind === "number" ? (
            <input
              id={`${id}-${field.key}`}
              type="number"
              inputMode="numeric"
              min={field.min}
              max={field.max}
              placeholder={field.label}
              value={values[field.key] ?? ""}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.key]: event.target.value }))
              }
            />
          ) : (
            <input
              id={`${id}-${field.key}`}
              type="text"
              placeholder={field.label}
              value={values[field.key] ?? ""}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.key]: event.target.value }))
              }
            />
          )}
        </span>
      ))}
      <label className="sr-only" htmlFor={`${id}-reason`}>
        {text("Reason", "Gerekçe", "دلیل")}
      </label>
      <input
        id={`${id}-reason`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder={text("Reason (recorded)", "Gerekçe (kaydedilir)", "دلیل (ثبت می‌شود)")}
      />
      <button
        type="button"
        className={variant === "danger" ? "btn btn-danger" : "btn"}
        onClick={submit}
        disabled={working}
      >
        {working
          ? text("Working…", "Çalışıyor…", "در حال انجام…")
          : armed && confirmLabel
            ? confirmLabel
            : label}
      </button>
      {message ? (
        <p className="form-status admin-action-error" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
