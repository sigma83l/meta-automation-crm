"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/src/lib/i18n/client";

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
  const { t } = useI18n();
  // Derived initial state, not an effect: when no site key is configured (local dev)
  // there is no Turnstile widget to produce a token, so start with the bypass token.
  // `turnstileSiteKey` comes from a NEXT_PUBLIC_* env var inlined at build time, so it
  // is identical on the server and the client and cannot cause a hydration mismatch.
  const [captchaToken, setCaptchaToken] = useState(() => (turnstileSiteKey ? "" : "local-pass"));
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const captcha = useRef<TurnstileInstance | null>(null);

  /**
   * A Turnstile token is single-use and short-lived. Once the server has
   * verified one, Cloudflare rejects any reuse as timeout-or-duplicate.
   *
   * The widget does not know that, so it keeps showing a solved tick while
   * holding a spent token. Any submit that leaves the user on this form must
   * therefore issue a fresh challenge, or the next attempt fails with "human
   * verification failed" no matter what they type.
   */
  function renewCaptcha() {
    if (!turnstileSiteKey) return;
    setCaptchaToken("");
    captcha.current?.reset();
  }

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
        setMessage(result.error?.message ?? t("auth.genericFailure"));
        renewCaptcha();
        return;
      }
      if (mode === "forgot-password") {
        setState("success");
        setMessage(t("auth.resetSent"));
        renewCaptcha();
        return;
      }
      if (result.value?.confirmationRequired) {
        setState("success");
        setMessage(t("auth.confirmEmail"));
        renewCaptcha();
        return;
      }
      router.push(result.value?.next ?? (mode === "reset-password" ? "/login" : "/dashboard"));
      router.refresh();
    } catch {
      setState("error");
      setMessage(t("auth.serverUnavailable"));
      renewCaptcha();
    }
  }

  return (
    <form className="auth-form" onSubmit={submit} aria-busy={state === "loading"}>
      {mode === "signup" ? (
        <label>
          {t("auth.businessName")}
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
          {t("auth.email")}
          <input name="email" type="email" required autoComplete="email" />
        </label>
      ) : null}
      {mode !== "forgot-password" ? (
        <label>
          {mode === "reset-password" ? t("auth.newPassword") : t("auth.password")}
          <input
            name="password"
            type="password"
            minLength={12}
            maxLength={128}
            required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
          <small>{t("auth.passwordHint")}</small>
        </label>
      ) : null}
      {turnstileSiteKey && mode !== "reset-password" ? (
        <Turnstile
          ref={captcha}
          siteKey={turnstileSiteKey}
          options={{
            action: mode === "forgot-password" ? "recovery" : mode === "signup" ? "signup" : "login"
          }}
          onSuccess={setCaptchaToken}
          // Tokens expire on their own after a few minutes. Drop the stale one
          // so the button disables rather than submitting something Cloudflare
          // will refuse.
          onExpire={() => setCaptchaToken("")}
          onError={() => {
            console.error("Turnstile error - check your site key and network");
            setCaptchaToken("");
          }}
        />
      ) : null}
      {message ? (
        <div className={`auth-notice ${state}`} role="status">
          {message}
        </div>
      ) : null}
      <button type="submit" disabled={state === "loading" || !captchaToken}>
        {state === "loading"
          ? t("auth.working")
          : t(
              mode === "signup"
                ? "auth.createPrivateWorkspace"
                : mode === "login"
                  ? "auth.signIn"
                  : mode === "forgot-password"
                    ? "auth.requestReset"
                    : "auth.setNewPassword"
            )}
      </button>
    </form>
  );
}
