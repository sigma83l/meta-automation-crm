import type { ServerEnvironment } from "@/src/lib/env";
import { configuredInfrastructure } from "@/src/lib/env";

export type HealthPayload = Readonly<{
  status: "ok";
  service: "meta-automation-crm";
  mode: "foundation";
  timestamp: string;
  infrastructure: Readonly<{
    supabase: "configured" | "pending";
    inngest: "configured" | "pending";
    liveSending: "disabled" | "enabled";
  }>;
}>;

export function buildHealthPayload(
  environment: ServerEnvironment,
  now = new Date()
): HealthPayload {
  const readiness = configuredInfrastructure(environment);
  return Object.freeze({
    status: "ok",
    service: "meta-automation-crm",
    mode: "foundation",
    timestamp: now.toISOString(),
    infrastructure: Object.freeze({
      supabase: readiness.supabase ? "configured" : "pending",
      inngest: readiness.inngest ? "configured" : "pending",
      liveSending: readiness.liveSending ? "enabled" : "disabled"
    })
  });
}
