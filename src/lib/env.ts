import { z } from "zod";

const optionalNonEmpty = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional()
);
const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional()
);
const optionalMetaVersion = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z
    .string()
    .regex(/^v\d{1,2}\.\d{1,2}$/)
    .optional()
);

const serverEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_DEPLOYMENT_MODE: z.enum(["local", "preview", "production"]).default("local"),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_PROVIDER: z.enum(["supabase", "neon"]).default("supabase"),
  NEON_AUTH_BASE_URL: optionalUrl,
  NEON_DATA_API_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  META_OAUTH_REDIRECT_URL: optionalUrl,
  NEON_AUTH_COOKIE_SECRET: optionalNonEmpty,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalNonEmpty,
  SUPABASE_SERVICE_ROLE_KEY: optionalNonEmpty,
  META_GRAPH_API_VERSION: optionalMetaVersion, // ← Make sure it's optionalMetaVersion, not z.string()...
  INNGEST_EVENT_KEY: optionalNonEmpty,
  INNGEST_SIGNING_KEY: optionalNonEmpty,
  LIVE_PROVIDER_SEND_ENABLED: z.enum(["true", "false"]).default("false"),
  LIVE_TEST_RECIPIENT_ALLOWLIST: z.string().default(""),
  CREDENTIAL_ENCRYPTION_KEY: optionalNonEmpty,
  PLATFORM_AI_PROVIDER: z.enum(["gemini", "openai", "anthropic"]).default("gemini"),
  PLATFORM_GEMINI_API_KEY: optionalNonEmpty,
  PLATFORM_OPENAI_API_KEY: optionalNonEmpty,
  PLATFORM_ANTHROPIC_API_KEY: optionalNonEmpty,
  AI_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),
  META_APP_ID: optionalNonEmpty,
  META_APP_SECRET: optionalNonEmpty,
  META_WEBHOOK_VERIFY_TOKEN: optionalNonEmpty,
  META_WHATSAPP_CONFIG_ID: optionalNonEmpty,
  META_CONNECTION_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
  ENABLE_EMAIL_CONFIRMATION: z.enum(["true", "false"]).default("false"),
  EMAIL_DELIVERY_VERIFIED: z.enum(["true", "false"]).default("false"),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: optionalNonEmpty,
  TURNSTILE_SECRET_KEY: optionalNonEmpty,
  AUTH_CAPTCHA_MODE: z.enum(["fake", "turnstile"]).default("fake"),
  AUTH_SIGNUP_MODE: z.enum(["self_service", "invite_only"]).default("self_service"),
  PREVIEW_OWNER_EMAIL_ALLOWLIST: z.string().default(""),
  AUTH_RATE_LIMIT_MODE: z.enum(["memory", "database"]).default("memory"),
  AUTH_RATE_LIMIT_HASH_KEY: optionalNonEmpty,
  AUTH_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(8),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
  CRM_MEDIA_MAX_BYTES: z.coerce.number().int().min(1024).max(10485760).default(10485760),
  CRM_EXPORT_MAX_ROWS: z.coerce.number().int().min(1).max(100000).default(25000),
  CRM_EXPORT_MAX_FILES: z.coerce.number().int().min(0).max(10000).default(1000),
  CRM_EXPORT_MAX_BYTES: z.coerce.number().int().min(1048576).max(104857600).default(104857600),
  CRM_EXPORT_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(900)
});

export type ServerEnvironment = Readonly<{
  nodeEnv: "development" | "test" | "production";
  deploymentMode: "local" | "preview" | "production";
  appUrl: string;
  databaseProvider: "supabase" | "neon";
  neonAuthBaseUrl?: string;
  neonDataApiUrl?: string;
  neonAuthCookieSecret?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
  inngestEventKey?: string;
  inngestSigningKey?: string;
  liveProviderSendEnabled: boolean;
  liveTestRecipientAllowlist: readonly string[];
  credentialEncryptionKey?: string;
  platformAiProvider: "gemini" | "openai" | "anthropic";
  platformGeminiApiKey?: string;
  platformOpenAiApiKey?: string;
  platformAnthropicApiKey?: string;
  aiProviderTimeoutMs: number;
  metaAppId?: string;
  metaAppSecret?: string;
  metaWebhookVerifyToken?: string;
  metaOauthRedirectUrl?: string;
  metaGraphApiVersion?: string;
  metaWhatsappConfigId?: string;
  metaConnectionMode: "sandbox" | "live";
  enableEmailConfirmation: boolean;
  emailDeliveryVerified: boolean;
  turnstileSiteKey?: string;
  turnstileSecretKey?: string;
  authCaptchaMode: "fake" | "turnstile";
  authSignupMode: "self_service" | "invite_only";
  previewOwnerEmailAllowlist: readonly string[];
  authRateLimitMode: "memory" | "database";
  authRateLimitHashKey?: string;
  authRateLimitMaxAttempts: number;
  authRateLimitWindowSeconds: number;
  crmMediaMaxBytes: number;
  crmExportMaxRows: number;
  crmExportMaxFiles: number;
  crmExportMaxBytes: number;
  crmExportTtlSeconds: number;
}>;

export function parseServerEnvironment(
  input: Record<string, string | undefined>
): ServerEnvironment {
  const parsed = serverEnvironmentSchema.parse(input);
  assertProductionConfiguration(parsed);
  return Object.freeze({
    nodeEnv: parsed.NODE_ENV,
    deploymentMode: parsed.APP_DEPLOYMENT_MODE,
    appUrl: parsed.NEXT_PUBLIC_APP_URL,
    databaseProvider: parsed.DATABASE_PROVIDER,
    ...(parsed.NEON_AUTH_BASE_URL ? { neonAuthBaseUrl: parsed.NEON_AUTH_BASE_URL } : {}),
    ...(parsed.NEON_DATA_API_URL ? { neonDataApiUrl: parsed.NEON_DATA_API_URL } : {}),
    ...(parsed.NEON_AUTH_COOKIE_SECRET
      ? { neonAuthCookieSecret: parsed.NEON_AUTH_COOKIE_SECRET }
      : {}),
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
    platformAiProvider: parsed.PLATFORM_AI_PROVIDER,
    ...(parsed.PLATFORM_GEMINI_API_KEY
      ? { platformGeminiApiKey: parsed.PLATFORM_GEMINI_API_KEY }
      : {}),
    ...(parsed.PLATFORM_OPENAI_API_KEY
      ? { platformOpenAiApiKey: parsed.PLATFORM_OPENAI_API_KEY }
      : {}),
    ...(parsed.PLATFORM_ANTHROPIC_API_KEY
      ? { platformAnthropicApiKey: parsed.PLATFORM_ANTHROPIC_API_KEY }
      : {}),
    aiProviderTimeoutMs: parsed.AI_PROVIDER_TIMEOUT_MS,
    ...(parsed.META_APP_ID ? { metaAppId: parsed.META_APP_ID } : {}),
    ...(parsed.META_APP_SECRET ? { metaAppSecret: parsed.META_APP_SECRET } : {}),
    ...(parsed.META_WEBHOOK_VERIFY_TOKEN
      ? { metaWebhookVerifyToken: parsed.META_WEBHOOK_VERIFY_TOKEN }
      : {}),
    ...(parsed.META_OAUTH_REDIRECT_URL
      ? { metaOauthRedirectUrl: parsed.META_OAUTH_REDIRECT_URL }
      : {}),
    ...(parsed.META_GRAPH_API_VERSION
      ? { metaGraphApiVersion: parsed.META_GRAPH_API_VERSION }
      : {}),
    ...(parsed.META_WHATSAPP_CONFIG_ID
      ? { metaWhatsappConfigId: parsed.META_WHATSAPP_CONFIG_ID }
      : {}),
    metaConnectionMode: parsed.META_CONNECTION_MODE,
    enableEmailConfirmation: parsed.ENABLE_EMAIL_CONFIRMATION === "true",
    emailDeliveryVerified: parsed.EMAIL_DELIVERY_VERIFIED === "true",
    ...(parsed.NEXT_PUBLIC_TURNSTILE_SITE_KEY
      ? { turnstileSiteKey: parsed.NEXT_PUBLIC_TURNSTILE_SITE_KEY }
      : {}),
    ...(parsed.TURNSTILE_SECRET_KEY ? { turnstileSecretKey: parsed.TURNSTILE_SECRET_KEY } : {}),
    authCaptchaMode: parsed.AUTH_CAPTCHA_MODE,
    authSignupMode: parsed.AUTH_SIGNUP_MODE,
    previewOwnerEmailAllowlist: Object.freeze(
      parsed.PREVIEW_OWNER_EMAIL_ALLOWLIST.split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    ),
    authRateLimitMode: parsed.AUTH_RATE_LIMIT_MODE,
    ...(parsed.AUTH_RATE_LIMIT_HASH_KEY
      ? { authRateLimitHashKey: parsed.AUTH_RATE_LIMIT_HASH_KEY }
      : {}),
    authRateLimitMaxAttempts: parsed.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    authRateLimitWindowSeconds: parsed.AUTH_RATE_LIMIT_WINDOW_SECONDS,
    crmMediaMaxBytes: parsed.CRM_MEDIA_MAX_BYTES,
    crmExportMaxRows: parsed.CRM_EXPORT_MAX_ROWS,
    crmExportMaxFiles: parsed.CRM_EXPORT_MAX_FILES,
    crmExportMaxBytes: parsed.CRM_EXPORT_MAX_BYTES,
    crmExportTtlSeconds: parsed.CRM_EXPORT_TTL_SECONDS
  });
}

function assertProductionConfiguration(parsed: z.infer<typeof serverEnvironmentSchema>) {
  if (parsed.APP_DEPLOYMENT_MODE !== "production") return;
  const databaseRequired =
    parsed.DATABASE_PROVIDER === "neon"
      ? ([
          ["NEON_AUTH_BASE_URL", parsed.NEON_AUTH_BASE_URL],
          ["NEON_DATA_API_URL", parsed.NEON_DATA_API_URL],
          ["NEON_AUTH_COOKIE_SECRET", parsed.NEON_AUTH_COOKIE_SECRET]
        ] as const)
      : ([
          ["NEXT_PUBLIC_SUPABASE_URL", parsed.NEXT_PUBLIC_SUPABASE_URL],
          ["NEXT_PUBLIC_SUPABASE_ANON_KEY", parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY],
          ["SUPABASE_SERVICE_ROLE_KEY", parsed.SUPABASE_SERVICE_ROLE_KEY]
        ] as const);
  const required = [
    ...databaseRequired,
    ["INNGEST_EVENT_KEY", parsed.INNGEST_EVENT_KEY],
    ["INNGEST_SIGNING_KEY", parsed.INNGEST_SIGNING_KEY],
    ["CREDENTIAL_ENCRYPTION_KEY", parsed.CREDENTIAL_ENCRYPTION_KEY],
    ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", parsed.NEXT_PUBLIC_TURNSTILE_SITE_KEY],
    ["TURNSTILE_SECRET_KEY", parsed.TURNSTILE_SECRET_KEY],
    ["AUTH_RATE_LIMIT_HASH_KEY", parsed.AUTH_RATE_LIMIT_HASH_KEY]
  ] as const;
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new Error(`Production configuration missing required names: ${missing.join(", ")}`);
  }
  if (new URL(parsed.NEXT_PUBLIC_APP_URL).protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_APP_URL must use HTTPS in production.");
  }
  if (parsed.AUTH_CAPTCHA_MODE !== "turnstile" || parsed.AUTH_RATE_LIMIT_MODE !== "database") {
    throw new Error("Production requires Turnstile and database rate limiting.");
  }
  if (
    parsed.AUTH_SIGNUP_MODE === "self_service" &&
    (parsed.ENABLE_EMAIL_CONFIRMATION !== "true" || parsed.EMAIL_DELIVERY_VERIFIED !== "true")
  ) {
    throw new Error(
      "Production self-service signup requires verified email delivery and confirmation."
    );
  }
  if ((parsed.AUTH_RATE_LIMIT_HASH_KEY?.length ?? 0) < 32) {
    throw new Error("AUTH_RATE_LIMIT_HASH_KEY must contain at least 32 characters.");
  }
  if (parsed.META_CONNECTION_MODE === "live") {
    const callback = parsed.META_OAUTH_REDIRECT_URL
      ? new URL(parsed.META_OAUTH_REDIRECT_URL)
      : undefined;
    const app = new URL(parsed.NEXT_PUBLIC_APP_URL);
    if (
      !parsed.META_APP_ID ||
      !parsed.META_APP_SECRET ||
      !parsed.META_WEBHOOK_VERIFY_TOKEN ||
      !parsed.META_GRAPH_API_VERSION ||
      !parsed.META_WHATSAPP_CONFIG_ID ||
      !callback ||
      callback.origin !== app.origin ||
      callback.pathname !== "/api/connections/meta/callback"
    ) {
      throw new Error("Live Meta mode requires exact same-origin provider configuration.");
    }
  }
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
