import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ESCALATION_CONFIDENCE_THRESHOLD,
  MODEL_ROLES,
  generativeCallBudget,
  mayAnswerCustomer,
  resolveModel,
  selectRole,
  toolsForIntent,
  type RoutingSignals
} from "@/src/modules/rcos/router";

const signals = (over: Partial<RoutingSignals> = {}): RoutingSignals => ({
  confidence: 0.9,
  highStakes: false,
  answerIsKnown: false,
  ...over
});

describe("prefer not to generate", () => {
  it("uses no model when the answer is already known", () => {
    // The largest single source of both cost and invented facts is generating
    // a value the system could have read.
    expect(selectRole("customer_reply", signals({ answerIsKnown: true }))).toBe("deterministic");
    expect(selectRole("known_value", signals())).toBe("deterministic");
  });

  it("spends nothing on a deterministic turn", () => {
    expect(generativeCallBudget("deterministic", signals())).toBe(0);
  });
});

describe("role selection", () => {
  it.each(["intent_classification", "language_detection", "extraction", "summarisation"] as const)(
    "routes %s to the small model",
    (task) => {
      expect(selectRole(task, signals())).toBe("utility");
    }
  );

  it("routes a confident customer reply to the primary model", () => {
    expect(selectRole("customer_reply", signals())).toBe("primary");
  });

  it("escalates only when doubt and stakes coincide", () => {
    // Escalation is slower and dearer, so uncertainty alone must not trigger it.
    expect(selectRole("customer_reply", signals({ confidence: 0.2, highStakes: false }))).toBe(
      "primary"
    );
    expect(selectRole("customer_reply", signals({ confidence: 0.9, highStakes: true }))).toBe(
      "primary"
    );
    expect(selectRole("customer_reply", signals({ confidence: 0.2, highStakes: true }))).toBe(
      "escalation"
    );
  });

  it("treats the threshold as exclusive", () => {
    expect(
      selectRole(
        "customer_reply",
        signals({ confidence: ESCALATION_CONFIDENCE_THRESHOLD, highStakes: true })
      )
    ).toBe("primary");
  });
});

describe("the offline evaluator stays offline", () => {
  it("is chosen for golden-set work", () => {
    expect(selectRole("golden_set_evaluation", signals())).toBe("offline_evaluator");
  });

  it("is never allowed to answer a customer", () => {
    expect(mayAnswerCustomer("offline_evaluator")).toBe(false);
  });

  it("is never selected for a customer reply, however the signals look", () => {
    for (const confidence of [0, 0.3, 0.55, 0.99]) {
      for (const highStakes of [true, false]) {
        const role = selectRole("customer_reply", signals({ confidence, highStakes }));
        expect(`${confidence}/${highStakes}:${role}`).not.toBe(
          `${confidence}/${highStakes}:offline_evaluator`
        );
      }
    }
  });

  it("keeps the utility model out of customer-facing text as well", () => {
    // It is schema-constrained for extraction, not written for a reader.
    expect(mayAnswerCustomer("utility")).toBe(false);
  });
});

describe("generative call budget", () => {
  it("allows one call on a normal turn", () => {
    expect(generativeCallBudget("primary", signals())).toBe(1);
  });

  it("allows a second pass only where the first is genuinely unreliable", () => {
    // An unbounded retry loop is how one conversation quietly costs more than
    // the customer is worth.
    expect(generativeCallBudget("primary", signals({ confidence: 0.2, highStakes: true }))).toBe(2);
    expect(generativeCallBudget("primary", signals({ confidence: 0.2 }))).toBe(1);
  });
});

describe("model identifiers are configuration", () => {
  it("resolves a configured role", () => {
    expect(resolveModel("primary", { primary: "configured-primary" })).toEqual({
      ok: true,
      value: "configured-primary"
    });
  });

  it("fails loudly rather than substituting a default", () => {
    // A silent fallback would change behaviour, cost and safety characteristics
    // without anyone noticing.
    const result = resolveModel("escalation", { primary: "configured-primary" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CONFIGURATION_MISSING");
  });

  it("hard-codes no provider model identifier anywhere in the router", () => {
    // The pack requires provider and model IDs to be config-only. Reading the
    // source is the only way to prove the rule holds rather than merely being
    // followed by convention today.
    const source = readFileSync(
      fileURLToPath(new URL("../../src/modules/rcos/router.ts", import.meta.url)),
      "utf8"
    );
    for (const pattern of [
      /\bgpt-[\w.]+/i,
      /\bclaude-[\w.]+/i,
      /\bgemini-[\w.]+/i,
      /\bo\d-(?:mini|preview)/i,
      /\bmistral-[\w.]+/i
    ]) {
      expect(`${pattern}:${pattern.test(source)}`).toBe(`${pattern}:false`);
    }
  });
});

describe("tool exposure", () => {
  it("offers only the tools an intent could need", () => {
    // A model cannot misuse a tool it was never offered.
    const catalogue = { pricing: ["read_price"], booking: ["read_slots", "book_slot"] };
    expect(toolsForIntent("pricing", catalogue)).toEqual(["read_price"]);
  });

  it("falls back to an explicit list rather than everything", () => {
    expect(toolsForIntent("unknown_intent", { pricing: ["read_price"] }, ["read_price"])).toEqual([
      "read_price"
    ]);
  });

  it("offers nothing when no fallback is given", () => {
    expect(toolsForIntent("unknown_intent", {})).toEqual([]);
  });
});

describe("role table", () => {
  it("classifies every declared role as customer-facing or not", () => {
    for (const role of MODEL_ROLES) {
      expect(`${role}:${typeof mayAnswerCustomer(role)}`).toBe(`${role}:boolean`);
    }
  });
});
