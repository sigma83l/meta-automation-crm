import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve("scripts/production-preflight.mjs");

describe("production deployment preflight", () => {
  it("fails with names only when owner/infrastructure gates are absent", () => {
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" }
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Production preflight blocked");
    expect(result.stderr).toContain("PRODUCTION_DEPLOYMENT_APPROVED");
  });

  it("passes complete approved names without printing their values", () => {
    const secretMarker = "synthetic-sensitive-marker";
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "test",
        APP_DEPLOYMENT_MODE: "production",
        NEXT_PUBLIC_APP_URL: "https://crm.example.test",
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: secretMarker,
        SUPABASE_SERVICE_ROLE_KEY: secretMarker,
        INNGEST_EVENT_KEY: secretMarker,
        INNGEST_SIGNING_KEY: secretMarker,
        CREDENTIAL_ENCRYPTION_KEY: secretMarker,
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: secretMarker,
        TURNSTILE_SECRET_KEY: secretMarker,
        AUTH_RATE_LIMIT_HASH_KEY: `${secretMarker}-at-least-32-characters`,
        AUTH_CAPTCHA_MODE: "turnstile",
        AUTH_SIGNUP_MODE: "invite_only",
        AUTH_RATE_LIMIT_MODE: "database",
        LIVE_PROVIDER_SEND_ENABLED: "false",
        META_CONNECTION_MODE: "sandbox",
        VERCEL_COMMERCIAL_PLAN_CONFIRMED: "true",
        PRODUCTION_DEPLOYMENT_APPROVED: "true"
      }
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("values were not printed");
    expect(`${result.stdout}${result.stderr}`).not.toContain(secretMarker);
  });
});
