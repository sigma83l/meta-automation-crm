import "server-only";

import { getServerEnvironment } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

import { FakeCaptchaProvider, TurnstileCaptchaProvider } from "./adapters/captcha";
import { DatabaseRateLimiter, MemoryRateLimiter } from "./adapters/rate-limiter";
import { SupabaseAuthRepository } from "./adapters/supabase-auth-repository";
import { AuthService } from "./service";

const environment = getServerEnvironment();
const memoryLimiter = new MemoryRateLimiter(
  environment.authRateLimitMaxAttempts,
  environment.authRateLimitWindowSeconds * 1_000
);

export async function createAuthService() {
  const client = await createSupabaseServerClient();
  const captcha =
    environment.authCaptchaMode === "turnstile"
      ? new TurnstileCaptchaProvider(
          requiredTurnstileSecret(),
          new URL(environment.appUrl).hostname
        )
      : new FakeCaptchaProvider();
  if (environment.deploymentMode === "production" && environment.authCaptchaMode === "fake") {
    throw new Error("Fake CAPTCHA is forbidden in production.");
  }
  if (environment.deploymentMode === "production" && environment.authRateLimitMode !== "database") {
    throw new Error("Database rate limiting is required in production.");
  }
  const limiter =
    environment.authRateLimitMode === "database"
      ? new DatabaseRateLimiter(
          client,
          environment.authRateLimitMaxAttempts,
          environment.authRateLimitWindowSeconds,
          requiredRateLimitHashKey()
        )
      : memoryLimiter;
  return new AuthService(
    new SupabaseAuthRepository(client, environment.appUrl),
    captcha,
    limiter,
    environment.enableEmailConfirmation,
    environment.authSignupMode === "self_service"
  );
}

function requiredTurnstileSecret() {
  if (!environment.turnstileSecretKey) {
    throw new Error("TURNSTILE_SECRET_KEY is required in Turnstile mode.");
  }
  return environment.turnstileSecretKey;
}

function requiredRateLimitHashKey() {
  if (!environment.authRateLimitHashKey || environment.authRateLimitHashKey.length < 32) {
    throw new Error("AUTH_RATE_LIMIT_HASH_KEY must contain at least 32 characters.");
  }
  return environment.authRateLimitHashKey;
}
