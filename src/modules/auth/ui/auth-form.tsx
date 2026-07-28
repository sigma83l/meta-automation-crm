"use client";

import { Turnstile } from "@marsidev/react-turnstile";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Mode = "signup" | "login" | "forgot-password" | "reset-password";
type ApiResponse = {
  ok: boolean;
  value?: { next?: string; confirmationRequired?: boolean };
  error?: { code: string; message: string };
};

export function AuthForm({
  mode,
  turnstileSiteKey
}: {
  mode: Mode;
  turnstileSiteKey?: string | undefined;
}) {
  const router = useRouter();
  const [captchaToken, setCaptchaToken] = useState(turnstileSiteKey ? "" : "local-pass");
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("loading");
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const csrf = (await fetch("/api/auth/csrf").then((response) => response.json())) as {
        token: string;
      };
      const payload = Object.fromEntries(form.entries());
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrf.token },
        body: JSON.stringify({ ...payload, captchaToken })
      });
      const result = (await response.json()) as ApiResponse;
      if (!result.ok) {
        setState("error");
        setMessage(result.error?.message ?? "The request could not be completed.");
        return;
      }
      if (mode === "forgot-password") {
        setState("success");
        setMessage("If an account is eligible, password reset instructions have been sent.");
        return;
      }
      if (result.value?.confirmationRequired) {
        setState("success");
        setMessage("Check your email to confirm the account before signing in.");
        return;
      }
      router.push(result.value?.next ?? (mode === "reset-password" ? "/login" : "/dashboard"));
      router.refresh();
    } catch {
      setState("error");
      setMessage("The server is unavailable. Try again.");
    }
  }

  return (
    <form className="auth-form" onSubmit={submit} aria-busy={state === "loading"}>
      {mode === "signup" ? (
        <label>
          Business name
          <input
            name="businessName"
            minLength={2}
            maxLength={80}
            required
            autoComplete="organization"
          />
        </label>
      ) : null}
      {mode !== "reset-password" ? (
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
      ) : null}
      {mode !== "forgot-password" ? (
        <label>
          {mode === "reset-password" ? "New password" : "Password"}
          <input
            name="password"
            type="password"
            minLength={12}
            maxLength={128}
            required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
          <small>At least 12 characters.</small>
        </label>
      ) : null}
      {turnstileSiteKey && mode !== "reset-password" ? (
        <Turnstile siteKey={turnstileSiteKey} onSuccess={setCaptchaToken} />
      ) : null}
      {message ? (
        <div className={`auth-notice ${state}`} role="status">
          {message}
        </div>
      ) : null}
      <button type="submit" disabled={state === "loading" || !captchaToken}>
        {state === "loading" ? "Working…" : buttonLabel(mode)}
      </button>
    </form>
  );
}

function buttonLabel(mode: Mode) {
  return {
    signup: "Create private workspace",
    login: "Sign in",
    "forgot-password": "Request reset",
    "reset-password": "Set new password"
  }[mode];
}
