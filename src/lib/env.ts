import { z } from "zod";

const optionalNonEmpty = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional()
);

const serverEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalNonEmpty,
  SUPABASE_SERVICE_ROLE_KEY: optionalNonEmpty,
  INNGEST_EVENT_KEY: optionalNonEmpty,
  INNGEST_SIGNING_KEY: optionalNonEmpty,
  LIVE_PROVIDER_SEND_ENABLED: z.enum(["true", "false"]).default("false"),
  LIVE_TEST_RECIPIENT_ALLOWLIST: z.string().default(""),
  CREDENTIAL_ENCRYPTION_KEY: optionalNonEmpty,
  ENABLE_EMAIL_CONFIRMATION: z.enum(["true", "false"]).default("false"),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: optionalNonEmpty,
  TURNSTILE_SECRET_KEY: optionalNonEmpty,
  AUTH_CAPTCHA_MODE: z.enum(["fake", "turnstile"]).default("fake"),
  AUTH_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(8),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).max(3600).default(60)
});

export type ServerEnvironment = Readonly<{
  nodeEnv: "development" | "test" | "production";
  appUrl: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
  inngestEventKey?: string;
  inngestSigningKey?: string;
  liveProviderSendEnabled: boolean;
  liveTestRecipientAllowlist: readonly string[];
  credentialEncryptionKey?: string;
  enableEmailConfirmation: boolean;
  turnstileSiteKey?: string;
  turnstileSecretKey?: string;
  authCaptchaMode: "fake" | "turnstile";
  authRateLimitMaxAttempts: number;
  authRateLimitWindowSeconds: number;
}>;

export function parseServerEnvironment(
  input: Record<string, string | undefined>
): ServerEnvironment {
  const parsed = serverEnvironmentSchema.parse(input);
  return Object.freeze({
    nodeEnv: parsed.NODE_ENV,
    appUrl: parsed.NEXT_PUBLIC_APP_URL,
    ...(parsed.NEXT_PUBLIC_SUPABASE_URL ? { supabaseUrl: parsed.NEXT_PUBLIC_SUPABASE_URL } : {}),
    ...(parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ? { supabaseAnonKey: parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY }
      : {}),
    ...(parsed.SUPABASE_SERVICE_ROLE_KEY
      ? { supabaseServiceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY }
      : {}),
    ...(parsed.INNGEST_EVENT_KEY ? { inngestEventKey: parsed.INNGEST_EVENT_KEY } : {}),
    ...(parsed.INNGEST_SIGNING_KEY ? { inngestSigningKey: parsed.INNGEST_SIGNING_KEY } : {}),
    liveProviderSendEnabled: parsed.LIVE_PROVIDER_SEND_ENABLED === "true",
    liveTestRecipientAllowlist: Object.freeze(
      parsed.LIVE_TEST_RECIPIENT_ALLOWLIST.split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    ),
    ...(parsed.CREDENTIAL_ENCRYPTION_KEY
      ? { credentialEncryptionKey: parsed.CREDENTIAL_ENCRYPTION_KEY }
      : {}),
    enableEmailConfirmation: parsed.ENABLE_EMAIL_CONFIRMATION === "true",
    ...(parsed.NEXT_PUBLIC_TURNSTILE_SITE_KEY
      ? { turnstileSiteKey: parsed.NEXT_PUBLIC_TURNSTILE_SITE_KEY }
      : {}),
    ...(parsed.TURNSTILE_SECRET_KEY ? { turnstileSecretKey: parsed.TURNSTILE_SECRET_KEY } : {}),
    authCaptchaMode: parsed.AUTH_CAPTCHA_MODE,
    authRateLimitMaxAttempts: parsed.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    authRateLimitWindowSeconds: parsed.AUTH_RATE_LIMIT_WINDOW_SECONDS
  });
}

export function getServerEnvironment(): ServerEnvironment {
  return parseServerEnvironment(process.env);
}

export function configuredInfrastructure(environment: ServerEnvironment) {
  return Object.freeze({
    supabase:
      Boolean(environment.supabaseUrl) &&
      Boolean(environment.supabaseAnonKey) &&
      Boolean(environment.supabaseServiceRoleKey),
    inngest: Boolean(environment.inngestEventKey) && Boolean(environment.inngestSigningKey),
    credentialEncryption: Boolean(environment.credentialEncryptionKey),
    liveSending: environment.liveProviderSendEnabled
  });
}
