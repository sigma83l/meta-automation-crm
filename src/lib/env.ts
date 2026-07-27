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
  CREDENTIAL_ENCRYPTION_KEY: optionalNonEmpty
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
      : {})
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
