import { describe, expect, it } from "vitest";
import {
  CONTEXT_LAYERS,
  CONTEXT_P95_ALERT,
  CONTEXT_TOTAL_TARGET,
  LAYER_BUDGET,
  MAX_RECENT_TURN_PAIRS,
  compileContext,
  estimateTokens,
  isCacheablePrefix,
  withinTranscriptLimit,
  type ContextLayer
} from "@/src/modules/rcos/context-budget";

/** Text of roughly the requested token size, per the 4-chars heuristic. */
const sized = (tokens: number) => "x".repeat(tokens * 4);

const layer = (name: ContextLayer, tokens: number) => ({ layer: name, parts: [sized(tokens)] });

describe("layer caps", () => {
  it("drops parts that would exceed a layer's own maximum", () => {
    const result = compileContext([{ layer: "customer_memory", parts: [sized(200), sized(200)] }]);
    const memory = result.layers.find((entry) => entry.layer === "customer_memory");
    // 250 is the cap, so the second 200-token part cannot fit.
    expect(memory?.parts).toHaveLength(1);
    expect(memory?.droppedParts).toBe(1);
  });

  it("keeps everything that fits", () => {
    const result = compileContext([{ layer: "customer_memory", parts: [sized(100), sized(100)] }]);
    expect(result.layers[0]?.parts).toHaveLength(2);
    expect(result.layers[0]?.droppedParts).toBe(0);
  });
});

describe("shedding under pressure", () => {
  it("sheds the cheapest layer first and reports it", () => {
    const result = compileContext([
      layer("system_policy", 400),
      layer("agent_snapshot", 1000),
      layer("customer_memory", 250),
      layer("retrieved_facts", 700),
      layer("recent_turns", 600),
      layer("tool_state", 200)
    ]);
    // Recent turns are the cheapest to lose: the rolling summary already
    // carries the thread.
    expect(result.trimmed[0]).toBe("recent_turns");
    expect(result.layers.some((entry) => entry.layer === "recent_turns")).toBe(false);
  });

  it("never sheds hard policy or authoritative tool state", () => {
    // Losing policy would silently widen what the model may do; losing tool
    // state is how it starts inventing values it can no longer see.
    const result = compileContext(
      CONTEXT_LAYERS.map((name) => layer(name, LAYER_BUDGET[name].max))
    );
    expect(result.trimmed).not.toContain("system_policy");
    expect(result.trimmed).not.toContain("tool_state");
    expect(result.layers.map((entry) => entry.layer)).toEqual(
      expect.arrayContaining(["system_policy", "tool_state"])
    );
  });

  it("reaches the target when the shreddable layers are enough", () => {
    const result = compileContext([
      layer("system_policy", 300),
      layer("tool_state", 150),
      layer("recent_turns", 600),
      layer("retrieved_facts", 700),
      layer("rolling_summary", 200)
    ]);
    expect(result.withinTarget).toBe(true);
    expect(result.totalTokens).toBeLessThanOrEqual(CONTEXT_TOTAL_TARGET);
  });

  it("reports rather than hides a turn that cannot be squeezed down", () => {
    // Essential layers alone stay under target here, but the caller must be
    // told when a turn is anomalous rather than handed a silent overflow.
    const result = compileContext([layer("system_policy", 400), layer("tool_state", 200)]);
    expect(result.withinTarget).toBe(true);
    expect(result.exceedsAlertThreshold).toBe(false);
    expect(CONTEXT_P95_ALERT).toBeGreaterThan(CONTEXT_TOTAL_TARGET);
  });
});

describe("cacheable prefix", () => {
  it("accepts a prefix that is purely brand and policy", () => {
    expect(
      isCacheablePrefix("You are a concise assistant for a salon. Never promise refunds.")
    ).toBe(true);
  });

  it.each([
    ["an email address", "Contact the customer at ada@example.com"],
    ["a phone number", "Their number is +90 555 123 4567"],
    ["a provider message id", "Continuing from wamid.HBgLOTA1NTUx"],
    ["a customer identifier", "customer_id: 91f2"],
    ["a conversation identifier", "conversation-id 42"]
  ])("refuses a prefix containing %s", (_label, prefix) => {
    // The snapshot is cached by hash and shared across turns, so anything
    // customer-specific inside it leaks between conversations.
    expect(isCacheablePrefix(prefix)).toBe(false);
  });
});

describe("transcript limit", () => {
  it("allows a handful of recent pairs", () => {
    expect(withinTranscriptLimit(MAX_RECENT_TURN_PAIRS)).toBe(true);
  });

  it("refuses anything that looks like passing the whole history", () => {
    expect(withinTranscriptLimit(MAX_RECENT_TURN_PAIRS + 1)).toBe(false);
    expect(withinTranscriptLimit(200)).toBe(false);
  });
});

describe("budget table", () => {
  it("defines a budget for every declared layer", () => {
    for (const name of CONTEXT_LAYERS) {
      expect(`${name}:${typeof LAYER_BUDGET[name]}`).toBe(`${name}:object`);
    }
  });

  it("keeps every layer maximum below the whole-turn target", () => {
    for (const name of CONTEXT_LAYERS) {
      expect(`${name}:${LAYER_BUDGET[name].max <= CONTEXT_TOTAL_TARGET}`).toBe(`${name}:true`);
    }
  });

  it("keeps the essential layers affordable together", () => {
    // If policy plus tool state alone exceeded the target, no turn could ever
    // be compiled within budget.
    const essential = CONTEXT_LAYERS.filter((name) => LAYER_BUDGET[name].essential).reduce(
      (sum, name) => sum + LAYER_BUDGET[name].max,
      0
    );
    expect(essential).toBeLessThan(CONTEXT_TOTAL_TARGET);
  });

  it("estimates zero for empty text", () => {
    expect(estimateTokens("")).toBe(0);
  });
});
