const requiredNames = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "CREDENTIAL_ENCRYPTION_KEY",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "AUTH_RATE_LIMIT_HASH_KEY"
];

const missing = requiredNames.filter((name) => !process.env[name]?.trim());
const violations = [];
if (process.env.APP_DEPLOYMENT_MODE !== "production") violations.push("APP_DEPLOYMENT_MODE");
if (process.env.AUTH_CAPTCHA_MODE !== "turnstile") violations.push("AUTH_CAPTCHA_MODE");
if (process.env.AUTH_RATE_LIMIT_MODE !== "database") violations.push("AUTH_RATE_LIMIT_MODE");
if (process.env.VERCEL_COMMERCIAL_PLAN_CONFIRMED !== "true")
  violations.push("VERCEL_COMMERCIAL_PLAN_CONFIRMED");
if (process.env.PRODUCTION_DEPLOYMENT_APPROVED !== "true")
  violations.push("PRODUCTION_DEPLOYMENT_APPROVED");
if (process.env.LIVE_PROVIDER_SEND_ENABLED !== "false")
  violations.push("LIVE_PROVIDER_SEND_ENABLED");
if (process.env.META_CONNECTION_MODE !== "sandbox") violations.push("META_CONNECTION_MODE");
if (
  process.env.AUTH_SIGNUP_MODE === "self_service" &&
  (process.env.ENABLE_EMAIL_CONFIRMATION !== "true" ||
    process.env.EMAIL_DELIVERY_VERIFIED !== "true")
) {
  violations.push("PUBLIC_SIGNUP_VERIFICATION");
}
try {
  if (new URL(process.env.NEXT_PUBLIC_APP_URL ?? "").protocol !== "https:")
    violations.push("NEXT_PUBLIC_APP_URL");
} catch {
  violations.push("NEXT_PUBLIC_APP_URL");
}
if ((process.env.AUTH_RATE_LIMIT_HASH_KEY?.length ?? 0) < 32)
  violations.push("AUTH_RATE_LIMIT_HASH_KEY_LENGTH");

if (missing.length || violations.length) {
  process.stderr.write(
    `Production preflight blocked. Missing names: ${missing.join(", ") || "none"}. Invalid gates: ${
      [...new Set(violations)].join(", ") || "none"
    }.\n`
  );
  process.exit(1);
}

process.stdout.write(
  `Production preflight passed for ${requiredNames.length} required names; values were not printed.\n`
);
