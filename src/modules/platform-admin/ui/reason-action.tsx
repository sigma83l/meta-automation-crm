"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

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
 * ## Why the form is closed until asked for
 *
 * It used to render expanded, always. That is defensible for a page holding one
 * action and indefensible for a directory: `/admin/users` lists a hundred
 * people, each row carried two reason boxes and two buttons, and the screen
 * became four hundred controls and eleven thousand pixels of scroll — a wall of
 * red destructive buttons at rest, with the columns that identify _who_ each
 * row is squeezed into the left third. Nobody can scan that, and a control that
 * cannot be scanned is a control that gets pressed on the wrong row.
 *
 * So an action is a single quiet trigger until somebody chooses it, and the
 * reason field, the extra fields and the confirm button appear in place, in the
 * row, where the account being acted on is still on screen. The requirement is
 * unchanged — there is still no way to post without a reason — and the resting
 * state is now legible.
 *
 * Destructive actions keep their two deliberate presses (`confirmLabel`), and
 * the danger colour lives on the *confirm* button rather than on the trigger.
 * A directory painting every row's trigger red spends the strongest signal the
 * palette has on a state where nothing has happened yet; by the time the colour
 * appears here, the person has opened the form and typed a reason.
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
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const reasonRef = useRef<HTMLInputElement | null>(null);
  /**
   * Unique per instance, which the old id was not.
   *
   * It was derived from the endpoint and the label, so every row of a directory
   * calling the same endpoint produced the *same* id — and `htmlFor` resolves
   * to the first match in the document, so on `/admin/users` ninety-nine of a
   * hundred reason boxes had a label pointing at somebody else's row. The
   * screen-reader label existed and did nothing. `useId` is stable across
   * hydration, which a counter or a random value would not be.
   */
  const id = useId();

  const close = () => {
    setOpen(false);
    setArmed(false);
    setMessage(null);
    setReason("");
  };

  const submit = async () => {
    if (reason.trim().length < 3) {
      setMessage(
        text(
          "Give a reason of at least 3 characters.",
          "En az 3 karakterlik bir gerekçe girin.",
          "دلیلی با حداقل ۳ نویسه بنویسید."
        )
      );
      reasonRef.current?.focus();
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
      setOpen(false);
      // The server rendered this row; re-ask it rather than patching local state,
      // so what is on screen after the action is what the database actually says.
      router.refresh();
      return;
    }
    setMessage(result.message ?? null);
  };

  return (
    <div className={open ? "admin-action is-open" : "admin-action"}>
      <button
        type="button"
        className={variant === "danger" ? "admin-action-trigger is-danger" : "admin-action-trigger"}
        aria-expanded={open}
        aria-controls={`${id}-form`}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          setOpen(true);
          // The reason is the only required field, so it is where the caret
          // belongs; without this the person has opened a form and still has to
          // go find its first input.
          requestAnimationFrame(() => reasonRef.current?.focus());
        }}
      >
        {open ? text("Cancel", "Vazgeç", "لغو") : label}
      </button>

      <div className="admin-action-form" id={`${id}-form`} hidden={!open}>
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
          ref={reasonRef}
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
    </div>
  );
}
