import { NextResponse, type NextRequest } from "next/server";

import type { AppError, Result } from "@/src/lib/result";

export function authContext(request: NextRequest, captchaToken: string) {
  return {
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
    userAgent: request.headers.get("user-agent") ?? "unknown",
    captchaToken
  };
}

export function resultResponse<T>(result: Result<T>, successStatus = 200) {
  if (result.ok)
    return NextResponse.json({ ok: true, value: result.value }, { status: successStatus });
  return NextResponse.json(
    { ok: false, error: publicError(result.error) },
    { status: result.error.code === "AUTH_RATE_LIMITED" ? 429 : 400 }
  );
}

function publicError(error: AppError) {
  const messages: Partial<Record<AppError["code"], string>> = {
    VALIDATION_ERROR: "Check the information and try again.",
    AUTH_INVALID_CREDENTIALS: "Email or password could not be accepted.",
    AUTH_ACCOUNT_UNAVAILABLE: "This account is unavailable.",
    AUTH_SIGNUP_DISABLED:
      "Account creation is currently disabled for this deployment. Contact your workspace administrator.",
    AUTH_RATE_LIMITED: "Too many attempts. Try again shortly.",
    AUTH_CAPTCHA_FAILED: "Human verification failed.",
    AUTH_SESSION_EXPIRED: "Your session has expired.",
    AUTH_CSRF_FAILED: "The form expired. Refresh and try again."
  };
  return {
    code: error.code,
    // A weak password carries its own message, because the whole point is to
    // say which rule was missed - "needs a digit" and "needs an uppercase
    // letter" are different instructions. The strings come from this module's
    // own schema, never from user input or a provider.
    message:
      error.code === "AUTH_PASSWORD_TOO_WEAK"
        ? error.message
        : (messages[error.code] ?? "The request could not be completed.")
  };
}
