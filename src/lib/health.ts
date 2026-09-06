import type { ServerEnvironment } from "@/src/lib/env";
import { configuredInfrastructure } from "@/src/lib/env";

/**
 * Whether the database actually answered, as opposed to merely being
 * configured. "configured" only ever meant three environment strings were
 * non-empty, which made an unreachable or misconfigured project look identical
 * to a healthy one from outside.
 *
 * The project reference is deliberately NOT reported here: this endpoint is
 * public, and the deployment stores its Supabase URL as a write-only sensitive
 * value. The reference goes to the auth diagnostics log instead, where it is
 * visible to operators only.
 */
export type SupabaseReachability =
  /** The project answered and accepted the configured key. */
  | "reachable"
  /** The host answered but rejected the key: it belongs to a different project
   *  than the configured URL. Rotating one without the other causes this. */
  | "key-rejected"
  /** No answer at all — DNS, TLS or timeout. */
  | "unreachable"
  | "not-configured";

export type HealthPayload = Readonly<{
  status: "ok";
  service: "meta-automation-crm";
  mode: "foundation";
  timestamp: string;
  infrastructure: Readonly<{
    supabase: "configured" | "pending";
    supabaseConnection: SupabaseReachability;
    captcha: CaptchaConfiguration;
    inngest: "configured" | "pending";
    liveSending: "disabled" | "enabled";
  }>;
}>;

/**
 * Whether the captcha secret is one Cloudflare recognises.
 *
 * A site key and its secret are a pair, and this deployment has more than one
 * widget in play. A secret from the wrong widget lets the challenge render and
 * then fails every verification server-side, which is indistinguishable from a
 * user failing the captcha.
 *
 * This cannot prove the pair matches — Cloudflare will not say which widget a
 * secret belongs to — only that the secret itself is known.
 */
export type CaptchaConfiguration = "ok" | "secret-rejected" | "unreachable" | "not-configured";

export function buildHealthPayload(
  environment: ServerEnvironment,
  now = new Date(),
  supabaseConnection: SupabaseReachability = "not-configured",
  captcha: CaptchaConfiguration = "not-configured"
): HealthPayload {
  const readiness = configuredInfrastructure(environment);
  return Object.freeze({
    status: "ok",
    service: "meta-automation-crm",
    mode: "foundation",
    timestamp: now.toISOString(),
    infrastructure: Object.freeze({
      supabase: readiness.supabase ? "configured" : "pending",
      supabaseConnection,
      captcha,
      inngest: readiness.inngest ? "configured" : "pending",
      liveSending: readiness.liveSending ? "enabled" : "disabled"
    })
  });
}
