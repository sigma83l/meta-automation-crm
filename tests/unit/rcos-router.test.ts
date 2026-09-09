import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ESCALATION_CONFIDENCE_THRESHOLD,
  LOOKUP_CONFIDENCE_FLOOR,
  LOOKUP_MAX_APPROVED_ITEMS,
  LOOKUP_MAX_CONTEXT_TOKENS,
  LOOKUP_MAX_CUSTOMER_MESSAGES,
  MODEL_ROLES,
  generativeCallBudget,
  mayAnswerCustomer,
  resolveModel,
  resolveReplyModel,
  selectReplyModel,
  selectRole,
  toolsForIntent,
  type ReplyRoutingSignals,
  type RoutingSignals
} from "@/src/modules/rcos/router";

const signals = (over: Partial<RoutingSignals> = {}): RoutingSignals => ({
  confidence: 0.9,
  highStakes: false,
  answerIsKnown: false,
  ...over
});

/**
 * A turn that qualifies as a direct lookup on every axis.
 *
 * The numbers are the measured ones: six approved items and 850 context tokens
 * are what the golden fixture actually produces, so a test that overrides one
 * of them is testing that axis against the condition the threshold was set
 * from, rather than against a number invented for the test.
 */
const reply = (over: Partial<ReplyRoutingSignals> = {}): ReplyRoutingSignals => ({
  confidence: 0.95,
  highStakes: false,
  answerIsKnown: false,
  lowConfidenceThreshold: 0.6,
  approvedItemsOffered: 6,
  contextTokens: 850,
  customerMessages: 1,
  priorHandoff: false,
  ...over
});

const roleFor = (over: Partial<ReplyRoutingSignals> = {}) => selectReplyModel(reply(over)).role;

describe("prefer not to generate", () => {
  it("uses no model when the answer is already known", () => {
    // The largest single source of both cost and invented facts is generating
    // a value the system could have read.
    expect(roleFor({ answerIsKnown: true })).toBe("deterministic");
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

  it("escalates only when doubt and stakes coincide", () => {
    // Escalation is slower and dearer, so uncertainty alone must not trigger it.
    expect(roleFor({ confidence: 0.2, highStakes: false })).not.toBe("escalation");
    expect(roleFor({ confidence: 0.9, highStakes: true })).toBe("primary");
    expect(roleFor({ confidence: 0.2, highStakes: true })).toBe("escalation");
  });

  it("treats the escalation threshold as exclusive", () => {
    expect(roleFor({ confidence: ESCALATION_CONFIDENCE_THRESHOLD, highStakes: true })).toBe(
      "primary"
    );
  });
});

describe("the cheapest model that can answer this turn", () => {
  it("reads one approved answer with the cheap model", () => {
    // Measured: on the six-item golden fixture the small non-thinking model
    // answered all eight cases correctly, in about a second, spending no
    // reasoning tokens at all. Paying a thinking model to read back a stored
    // sentence buys nothing.
    const routed = selectReplyModel(reply());
    expect(routed.role).toBe("lookup");
    expect(routed.reasons).toEqual(["direct_lookup_against_approved_knowledge"]);
  });

  it("never economises on a turn with stakes", () => {
    expect(roleFor({ highStakes: true })).toBe("primary");
  });

  it("spends more where there is nothing approved to read", () => {
    // The turn most likely to invent something, and most likely to end at a
    // person. Both are reasons to use the better model, not the cheaper one.
    expect(roleFor({ approvedItemsOffered: 0 })).toBe("primary");
  });

  it("stops being a lookup once choosing between items is the work", () => {
    expect(roleFor({ approvedItemsOffered: LOOKUP_MAX_APPROVED_ITEMS })).toBe("lookup");
    expect(roleFor({ approvedItemsOffered: LOOKUP_MAX_APPROVED_ITEMS + 1 })).toBe("primary");
  });

  it("honours the workspace's own confidence threshold when it is stricter", () => {
    // A workspace that set 0.95 has said it would rather pay than be
    // approximately right. The platform floor may only raise that bar.
    expect(roleFor({ confidence: 0.9, lowConfidenceThreshold: 0.95 })).toBe("primary");
    expect(roleFor({ confidence: 0.9, lowConfidenceThreshold: 0.1 })).toBe("lookup");
  });

  it("applies the platform floor to a workspace that set a lower one", () => {
    expect(
      roleFor({ confidence: LOOKUP_CONFIDENCE_FLOOR - 0.01, lowConfidenceThreshold: 0.1 })
    ).toBe("primary");
  });

  it("declines a lookup once the context or the conversation grows", () => {
    expect(roleFor({ contextTokens: LOOKUP_MAX_CONTEXT_TOKENS + 1 })).toBe("primary");
    expect(roleFor({ customerMessages: LOOKUP_MAX_CUSTOMER_MESSAGES + 1 })).toBe("primary");
  });

  it("does not send the cheap model back into a conversation that needed a person", () => {
    expect(roleFor({ priorHandoff: true })).toBe("primary");
  });

  it("gives every reason, not the first one it found", () => {
    // An operator asking why the dearer model was used wants all of why.
    const routed = selectReplyModel(reply({ approvedItemsOffered: 0, priorHandoff: true }));
    expect(routed.reasons).toEqual(["prior_turn_needed_a_person", "nothing_approved_to_read"]);
  });

  it("only ever falls back towards the dearer model", () => {
    // The safety argument for the whole function: every escape spends more, so
    // a signal this cannot read can only make the choice more conservative.
    const escapes: Partial<ReplyRoutingSignals>[] = [
      { approvedItemsOffered: 0 },
      { contextTokens: 99_999 },
      { customerMessages: 99 },
      { priorHandoff: true },
      { confidence: 0 },
      { highStakes: true }
    ];
    for (const over of escapes) {
      expect(`${JSON.stringify(over)}:${roleFor(over)}`).not.toContain(":lookup");
    }
  });
});

describe("the lookup model is the one role permitted a substitute", () => {
  it("uses the primary model when no lookup model is configured", () => {
    // Primary is the more capable model: the substitution can cost more and
    // cannot answer worse. The alternative is a customer who gets no reply
    // because one more environment variable was unset.
    expect(resolveReplyModel("lookup", { primary: "vendor-model-a" })).toEqual({
      ok: true,
      value: "vendor-model-a"
    });
  });

  it("prefers its own model when there is one", () => {
    expect(
      resolveReplyModel("lookup", { lookup: "vendor-model-small", primary: "vendor-model-a" })
    ).toEqual({ ok: true, value: "vendor-model-small" });
  });

  it("never substitutes for any other role", () => {
    // For every other role a substitute changes what the model is allowed to
    // do, not only what it costs.
    expect(resolveReplyModel("escalation", { primary: "vendor-model-a" }).ok).toBe(false);
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
        const role = roleFor({ confidence, highStakes });
        expect(`${confidence}/${highStakes}:${role}`).not.toBe(
          `${confidence}/${highStakes}:offline_evaluator`
        );
      }
    }
  });

  it("keeps the utility model out of customer-facing text as well", () => {
    // It is schema-constrained for extraction, not written for a reader. This
    // is why `lookup` was added as its own role rather than by relaxing this:
    // a cheap customer-facing role is worth having, and this rule is worth
    // keeping.
    expect(mayAnswerCustomer("utility")).toBe(false);
    expect(mayAnswerCustomer("lookup")).toBe(true);
    for (const confidence of [0, 0.5, 0.95, 1]) {
      expect(roleFor({ confidence })).not.toBe("utility");
    }
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
