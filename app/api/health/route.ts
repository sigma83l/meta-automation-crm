import { NextResponse } from "next/server";
import { getServerEnvironment } from "@/src/lib/env";
import {
  buildHealthPayload,
  type CaptchaConfiguration,
  type SupabaseReachability
} from "@/src/lib/health";

export const dynamic = "force-dynamic";

/**
 * Asks the database whether it is actually there.
 *
 * Reporting only that environment variables are set made an unreachable or
 * wrongly-configured project indistinguishable from a healthy one, which is
 * exactly the ambiguity that made a sign-in failure hard to place. This issues
 * one cheap, bounded, unauthenticated request against the REST root: it needs
 * no table, returns no data, and cannot leak anything.
 */
async function probeSupabase(): Promise<SupabaseReachability> {
  const environment = getServerEnvironment();
  if (!environment.supabaseUrl || !environment.supabaseAnonKey) return "not-configured";
  try {
    // /auth/v1/settings is the one endpoint that discriminates: it answers 200
    // for a key belonging to this project and 401 for one that does not, so a
    // URL rotated without its matching key is visible rather than silent.
    const response = await fetch(`${environment.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: environment.supabaseAnonKey },
      signal: AbortSignal.timeout(4000),
      cache: "no-store"
    });
    if (response.ok) return "reachable";
    return response.status === 401 || response.status === 403 ? "key-rejected" : "reachable";
  } catch {
    // DNS failure, TLS failure or timeout: nothing answered.
    return "unreachable";
  }
}

/**
 * Asks Cloudflare whether it recognises the configured captcha secret.
 *
 * siteverify answers "invalid-input-secret" for a secret it does not know, and
 * "invalid-input-response" when the secret is fine but the token is not — so a
 * deliberately invalid token separates a misconfigured secret from a healthy
 * one without needing a real challenge.
 */
async function probeCaptcha(): Promise<CaptchaConfiguration> {
  const environment = getServerEnvironment();
  if (environment.authCaptchaMode !== "turnstile") return "not-configured";
  if (!environment.turnstileSecretKey) return "not-configured";
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({
        secret: environment.turnstileSecretKey,
        response: "health-probe-not-a-real-token"
      }),
      signal: AbortSignal.timeout(4000),
      cache: "no-store"
    });
    const body = (await response.json()) as { "error-codes"?: readonly string[] };
    const codes = body["error-codes"] ?? [];
    return codes.includes("invalid-input-secret") ? "secret-rejected" : "ok";
  } catch {
    return "unreachable";
  }
}

export async function GET() {
  return NextResponse.json(
    buildHealthPayload(
      getServerEnvironment(),
      new Date(),
      await probeSupabase(),
      await probeCaptcha()
    ),
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
