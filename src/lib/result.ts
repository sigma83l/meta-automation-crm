export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "CONFIGURATION_MISSING"
  | "LIVE_SEND_BLOCKED"
  | "PROVIDER_UNAVAILABLE"
  | "AUTH_INVALID_CREDENTIALS"
  | "AUTH_ACCOUNT_UNAVAILABLE"
  | "AUTH_SIGNUP_DISABLED"
  | "AUTH_PASSWORD_TOO_WEAK"
  | "AUTH_RATE_LIMITED"
  | "AUTH_CAPTCHA_FAILED"
  | "AUTH_SESSION_EXPIRED"
  | "AUTH_EMAIL_CONFIRMATION_REQUIRED"
  | "AUTH_CSRF_FAILED"
  | "AI_PRIVACY_BLOCKED"
  | "AI_CREDENTIAL_UNAVAILABLE"
  | "BILLING_ENTITLEMENT_REQUIRED"
  | "BILLING_LIVE_BLOCKED"
  | "BILLING_CARD_REGISTRATION_FAILED"
  | "BILLING_STATE_INVALID"
  /** A provider price that exists at the provider but not in our catalogue. */
  | "BILLING_PRICE_UNKNOWN"
  | "BILLING_CHARGE_FAILED"
  | "UNEXPECTED_ERROR";

export type AppError = Readonly<{
  code: AppErrorCode;
  message: string;
  retryable: boolean;
  details?: Readonly<Record<string, string>>;
}>;

export type Result<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: AppError }>;

export function ok<T>(value: T): Result<T> {
  return Object.freeze({ ok: true, value });
}

export function err<T = never>(error: AppError): Result<T> {
  return Object.freeze({ ok: false, error: Object.freeze(error) });
}

export function appError(
  code: AppErrorCode,
  message: string,
  options: {
    retryable?: boolean;
    details?: Readonly<Record<string, string>>;
  } = {}
): AppError {
  return Object.freeze({
    code,
    message,
    retryable: options.retryable ?? false,
    ...(options.details ? { details: Object.freeze({ ...options.details }) } : {})
  });
}
