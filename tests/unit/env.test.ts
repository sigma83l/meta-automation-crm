import { describe, expect, it } from "vitest";
import { configuredInfrastructure, parseServerEnvironment } from "@/src/lib/env";

describe("environment contract", () => {
  it("defaults to sandbox-safe local settings", () => {
    const environment = parseServerEnvironment({});

    expect(environment.appUrl).toBe("http://localhost:3000");
    expect(environment.liveProviderSendEnabled).toBe(false);
    expect(environment.liveTestRecipientAllowlist).toEqual([]);
    expect(configuredInfrastructure(environment)).toEqual({
      supabase: false,
      inngest: false,
      credentialEncryption: false,
      liveSending: false,
      liveBilling: false
    });
  });

  it("rejects malformed public origins", () => {
    expect(() =>
      parseServerEnvironment({
        NEXT_PUBLIC_APP_URL: "not a valid origin"
      })
    ).toThrow();
  });

  it("parses an explicit allowlist without leaking it to public code", () => {
    const environment = parseServerEnvironment({
      LIVE_TEST_RECIPIENT_ALLOWLIST: "synthetic-1, synthetic-2 ",
      LIVE_PROVIDER_SEND_ENABLED: "true"
    });

    expect(environment.liveTestRecipientAllowlist).toEqual(["synthetic-1", "synthetic-2"]);
    expect(environment.liveProviderSendEnabled).toBe(true);
  });

  it("fails closed when an explicit production deployment lacks required infrastructure", () => {
    expect(() =>
      parseServerEnvironment({
        APP_DEPLOYMENT_MODE: "production",
        NEXT_PUBLIC_APP_URL: "https://crm.example.test"
      })
    ).toThrow("Production configuration missing required names");
  });

  it("accepts a complete sandbox production configuration without enabling live sending", () => {
    const environment = parseServerEnvironment({
      APP_DEPLOYMENT_MODE: "production",
      NEXT_PUBLIC_APP_URL: "https://crm.example.test",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-public-key",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-server-key",
      INNGEST_EVENT_KEY: "synthetic-event-key",
      INNGEST_SIGNING_KEY: "synthetic-signing-key",
      CREDENTIAL_ENCRYPTION_KEY: "synthetic-encryption-key-placeholder",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "synthetic-site-key",
      TURNSTILE_SECRET_KEY: "synthetic-turnstile-key",
      AUTH_CAPTCHA_MODE: "turnstile",
      AUTH_SIGNUP_MODE: "invite_only",
      AUTH_RATE_LIMIT_MODE: "database",
      AUTH_RATE_LIMIT_HASH_KEY: "synthetic-rate-limit-key-32-bytes-minimum",
      BILLING_FINGERPRINT_HASH_KEY: "synthetic-billing-fingerprint-key-32-bytes-minimum",
      BILLING_CALLBACK_STATE_SECRET: "synthetic-billing-callback-secret-32-bytes-minimum"
    });
    expect(environment.deploymentMode).toBe("production");
    expect(environment.liveProviderSendEnabled).toBe(false);
  });

  it("blocks production public signup until verification delivery is proven", () => {
    expect(() =>
      parseServerEnvironment({
        APP_DEPLOYMENT_MODE: "production",
        NEXT_PUBLIC_APP_URL: "https://crm.example.test",
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-public-key",
        SUPABASE_SERVICE_ROLE_KEY: "synthetic-server-key",
        INNGEST_EVENT_KEY: "synthetic-event-key",
        INNGEST_SIGNING_KEY: "synthetic-signing-key",
        CREDENTIAL_ENCRYPTION_KEY: "synthetic-encryption-key-placeholder",
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: "synthetic-site-key",
        TURNSTILE_SECRET_KEY: "synthetic-turnstile-key",
        AUTH_CAPTCHA_MODE: "turnstile",
        AUTH_SIGNUP_MODE: "self_service",
        AUTH_RATE_LIMIT_MODE: "database",
        AUTH_RATE_LIMIT_HASH_KEY: "synthetic-rate-limit-key-32-bytes-minimum"
      })
    ).toThrow("Production self-service signup requires verified email delivery");
  });
});
