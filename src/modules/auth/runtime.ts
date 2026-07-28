import "server-only";

import { getServerEnvironment } from "@/src/lib/env";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

import { FakeCaptchaProvider, TurnstileCaptchaProvider } from "./adapters/captcha";
import { MemoryRateLimiter } from "./adapters/rate-limiter";
import { SupabaseAuthRepository } from "./adapters/supabase-auth-repository";
import { AuthService } from "./service";

const environment = getServerEnvironment();
const limiter = new MemoryRateLimiter(
  environment.authRateLimitMaxAttempts,
  environment.authRateLimitWindowSeconds * 1_000
);

export async function createAuthService() {
  const client = await createSupabaseServerClient();
  const captcha =
    environment.authCaptchaMode === "turnstile"
      ? new TurnstileCaptchaProvider(requiredTurnstileSecret())
      : new FakeCaptchaProvider();
  if (environment.nodeEnv === "production" && environment.authCaptchaMode === "fake") {
    throw new Error("Fake CAPTCHA is forbidden in production.");
  }
  return new AuthService(
    new SupabaseAuthRepository(client, environment.appUrl),
    captcha,
    limiter,
    environment.enableEmailConfirmation
  );
}

function requiredTurnstileSecret() {
  if (!environment.turnstileSecretKey) {
    throw new Error("TURNSTILE_SECRET_KEY is required in Turnstile mode.");
  }
  return environment.turnstileSecretKey;
}
