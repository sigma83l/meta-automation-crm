import { describe, expect, it } from "vitest";
import { parseServerEnvironment } from "@/src/lib/env";
import { buildHealthPayload } from "@/src/lib/health";
import { inngestFoundationContract } from "@/src/lib/inngest/events";
import { supabaseFoundationContract } from "@/src/lib/supabase/contracts";
import { foundationModules } from "@/src/modules";

describe("foundation wiring", () => {
  it("reports health without exposing environment values", () => {
    const environment = parseServerEnvironment({
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-server-placeholder",
      INNGEST_EVENT_KEY: "synthetic-event-placeholder"
    });
    const payload = buildHealthPayload(environment, new Date("2026-07-27T12:00:00.000Z"));

    expect(payload).toEqual({
      status: "ok",
      service: "meta-automation-crm",
      mode: "foundation",
      timestamp: "2026-07-27T12:00:00.000Z",
      infrastructure: {
        supabase: "pending",
        inngest: "pending",
        liveSending: "disabled"
      }
    });
    expect(JSON.stringify(payload)).not.toContain("synthetic-server-placeholder");
    expect(JSON.stringify(payload)).not.toContain("synthetic-event-placeholder");
  });

  it("registers every planned business module", () => {
    expect(foundationModules.map((module) => module.id)).toEqual([
      "auth",
      "workspaces",
      "business-profile",
      "crm",
      "conversations",
      "automations",
      "integrations",
      "ai",
      "exports",
      "audit",
      "billing"
    ]);
  });

  it("registers production-shaped durable handlers without claiming hosted provisioning", () => {
    expect(supabaseFoundationContract.migrationsApplied).toBe(false);
    expect(supabaseFoundationContract.privateBucket).toBe("crm-private");
    expect(inngestFoundationContract.registeredFunctions).toBe(6);
    expect(inngestFoundationContract.productionEnvironmentRequired).toBe(true);
  });
});
