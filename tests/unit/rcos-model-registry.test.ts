import { describe, expect, it } from "vitest";
import {
  buildModelRegistry,
  configuredRoles,
  CONFIGURABLE_ROLES,
  ROLE_ENVIRONMENT_KEYS
} from "@/src/modules/rcos/model-registry";
import { MODEL_ROLES, resolveModel, selectReplyModel } from "@/src/modules/rcos/router";

describe("the registry supplies what the router refuses to name", () => {
  it("resolves a role the router selected", () => {
    // The two halves meeting: the router picks a role and names no model, the
    // registry turns that role into the configured identifier.
    const registry = buildModelRegistry({ primary: "vendor-model-a" });
    const { role } = selectReplyModel({
      confidence: 0.9,
      highStakes: true,
      answerIsKnown: false,
      lowConfidenceThreshold: 0.6,
      approvedItemsOffered: 3,
      contextTokens: 500,
      customerMessages: 1,
      priorHandoff: false
    });
    expect(resolveModel(role, registry)).toEqual({ ok: true, value: "vendor-model-a" });
  });

  it("covers every role that can reach a model", () => {
    // If a role is added to the router and not here, it can be selected and
    // never resolved — a failure that only appears on the turn that needs it.
    const missing = MODEL_ROLES.filter(
      (role) => role !== "deterministic" && !CONFIGURABLE_ROLES.includes(role as never)
    );
    expect(missing).toEqual([]);
  });

  it("has no entry for the deterministic role", () => {
    // That role means "no model call at all". An identifier for it would be a
    // contradiction that resolveModel would happily hand back.
    expect(Object.keys(ROLE_ENVIRONMENT_KEYS)).not.toContain("deterministic");
    const registry = buildModelRegistry({ primary: "vendor-model-a" });
    expect(registry.deterministic).toBeUndefined();
  });

  it("names one environment variable per configurable role", () => {
    const keys = Object.values(ROLE_ENVIRONMENT_KEYS);
    expect(keys).toHaveLength(CONFIGURABLE_ROLES.length);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("partial configuration is allowed, and fails at the point of use", () => {
  it("omits an unconfigured role rather than inventing one", () => {
    const registry = buildModelRegistry({ primary: "vendor-model-a" });
    expect(registry.escalation).toBeUndefined();
  });

  it("fails loudly when an unconfigured role is actually needed", () => {
    // The router's own rule: a silent substitution changes cost, behaviour and
    // safety without anyone noticing.
    const result = resolveModel("escalation", buildModelRegistry({ primary: "a" }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("CONFIGURATION_MISSING");
    expect(!result.ok && result.error.details?.role).toBe("escalation");
  });

  it("treats blank configuration as absent", () => {
    // An env var set to empty string is the shape a missing value actually
    // takes in a deploy pipeline, and it must not resolve to "".
    const registry = buildModelRegistry({ primary: "   ", utility: "vendor-model-b" });
    expect(registry.primary).toBeUndefined();
    expect(registry.utility).toBe("vendor-model-b");
  });

  it("reports which roles are serviceable", () => {
    const registry = buildModelRegistry({ primary: "a", offline_evaluator: "b" });
    expect(configuredRoles(registry)).toEqual(["primary", "offline_evaluator"]);
  });
});

describe("no model identifier is hardcoded", () => {
  it("keeps identifiers out of the source, as the router requires", async () => {
    // The router asserts this of itself; the registry is the other file that
    // could quietly acquire one.
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/modules/rcos/model-registry.ts", "utf8")
    );
    for (const vendorish of [/gpt-/i, /claude-/i, /gemini-\d/i, /o[134]-(mini|preview)/i]) {
      expect(source).not.toMatch(vendorish);
    }
  });
});
