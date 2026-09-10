import { describe, expect, it } from "vitest";
import { ok, err, appError, type Result } from "@/src/lib/result";
import type { AiProvider, TurnClassification, StructuredReply } from "@/src/modules/ai/contracts";
import {
  composedFrom,
  createAiTurnPorts,
  formatApprovedAmount,
  type TurnContext
} from "@/src/modules/rcos/ai-turn-ports";
import type { ModelConfiguration } from "@/src/modules/rcos/model-registry";
import type { TurnDecision, TurnEvent } from "@/src/modules/rcos/turn-engine";
import { TEST_BUSINESS } from "@/tests/fixtures/business-voice";

const FAQ_ID = "11111111-1111-4111-8111-111111111111";
const PRICE_ID = "22222222-2222-4222-8222-222222222222";

const event: TurnEvent = {
  eventId: "evt_1",
  workspaceId: "ws_1",
  conversationId: "conv_1",
  channel: "whatsapp",
  text: "Do you deliver?",
  occurredAt: "2026-08-19T00:00:00.000Z"
};

const context: TurnContext = {
  requiredFields: ["delivery_address"],
  knownFacts: [],
  faqItems: [{ id: FAQ_ID, question: "Do you deliver?", answer: "Weekdays only." }],
  priceItems: [
    {
      id: PRICE_ID,
      name: "Standard delivery",
      amountMinor: 12000,
      currency: "TRY",
      availability: "available"
    }
  ],
  policy: {
    primaryLanguage: "tr",
    fallbackLanguage: "en",
    forbiddenClaims: [],
    escalationKeywords: ["refund"],
    lowConfidenceThreshold: 0.6
  },
  business: TEST_BUSINESS,
  approvedTimes: ["09:00-17:00"],
  messages: [{ role: "customer", content: "Do you deliver?" }],
  classification: "webhook",
  demoMode: false,
  priorOutcomes: []
};

const reply: StructuredReply = {
  intent: "delivery_question",
  language: "en",
  extractedFields: {},
  missingRequiredFields: [],
  reply: "We deliver on weekdays.",
  knowledgeItemIds: [FAQ_ID],
  confidence: 0.9,
  needsHuman: false,
  reason: "From the approved FAQ."
};

type Stub = Readonly<{
  classification?: Result<TurnClassification>;
  reply?: Result<StructuredReply>;
}>;

function stubProvider(stub: Stub, log: string[], label: string): AiProvider {
  return {
    name: "deterministic-mock",
    async classifyTurn() {
      log.push(`${label}:classify`);
      return (
        stub.classification ??
        ok({ intent: "delivery_question", language: "en", confidence: 0.9, highStakes: false })
      );
    },
    async generateStructuredReply() {
      log.push(`${label}:reply`);
      return stub.reply ?? ok(reply);
    },
    async testConnection() {
      return ok({ available: true });
    },
    classifyProviderError() {
      return { kind: "unavailable", retryable: true };
    },
    getUsageMetadata() {
      return { inputTokens: 10, outputTokens: 5, model: label };
    }
  };
}

const MODELS = {
  utility: "model-utility",
  primary: "model-primary",
  escalation: "model-escalation"
};

function ports(
  stubs: { utility?: Stub; primary?: Stub; escalation?: Stub } = {},
  models: ModelConfiguration = MODELS
) {
  const log: string[] = [];
  const calls: { role: string; model: string }[] = [];
  const built = createAiTurnPorts({
    providers: {
      utility: stubProvider(stubs.utility ?? {}, log, "utility"),
      primary: stubProvider(stubs.primary ?? {}, log, "primary"),
      ...(stubs.escalation ? { escalation: stubProvider(stubs.escalation, log, "escalation") } : {})
    },
    models,
    loadContext: async () => context,
    onCall: (record) => calls.push({ role: record.role, model: record.model })
  });
  return { ports: built, log, calls };
}

const decision = (type: TurnDecision["type"] = "answer"): TurnDecision => ({
  type,
  priority: "p3_move_to_outcome",
  reasonCodes: []
});

describe("classification is the cheap first pass", () => {
  it("uses the utility role, not the primary one", async () => {
    // Naming what a customer wants is not answering it, and the router prices
    // those differently on purpose.
    const { ports: p, log, calls } = ports();
    await p.understand(event);
    expect(log).toEqual(["utility:classify"]);
    expect(calls).toEqual([{ role: "utility", model: "model-utility" }]);
  });

  it("returns the intent and locale the engine expects", async () => {
    const { ports: p } = ports();
    expect(await p.understand(event)).toEqual({
      intents: [{ name: "delivery_question", confidence: 0.9 }],
      locale: "en"
    });
  });

  it("becomes an uncertain understanding when the provider fails", async () => {
    // Not a throw. The engine's one safe answer to not knowing is a handoff,
    // reached through low confidence — the same route a genuinely unsure model
    // takes, so both causes are exercised by one path.
    const { ports: p } = ports({
      utility: { classification: err(appError("PROVIDER_UNAVAILABLE", "down")) }
    });
    const understanding = await p.understand(event);
    expect(understanding.intents[0]).toEqual({ name: "unknown", confidence: 0 });
    expect(understanding.locale).toBe("und");
  });

  it("is uncertain rather than guessing when no utility model is configured", async () => {
    const { ports: p, log } = ports({}, { primary: "model-primary" });
    expect((await p.understand(event)).intents[0]!.confidence).toBe(0);
    expect(log).toEqual([]);
  });
});

describe("retrieval, citation and approval agree by construction", () => {
  it("offers each approved item under its own id", async () => {
    // The model can only cite what it was shown, and it is shown these ids.
    const { ports: p } = ports();
    const retrieved = await p.retrieve(event, { intents: [], locale: "en" });
    expect(retrieved.facts.map((fact) => fact.ref)).toEqual([FAQ_ID, PRICE_ID]);
  });

  it("approves exactly the amounts it showed the model", async () => {
    // The validator blocks an amount that is not approved. If these two ever
    // rendered a price differently, every price reply would be blocked.
    const { ports: p } = ports();
    const retrieved = await p.retrieve(event, { intents: [], locale: "en" });
    expect(retrieved.approvedAmounts).toEqual(["120.00 TRY"]);
    expect(retrieved.facts[1]!.value).toContain("120.00 TRY");
    expect(formatApprovedAmount(12000, "TRY")).toBe("120.00 TRY");
  });

  it("keeps the workspace's own hours and adds the times inside them", async () => {
    // No longer passed straight through. "09:00-17:00" is a business-hours
    // entry, and a reply is entitled to state either boundary of it, so both
    // are approved alongside the entry itself.
    const { ports: p } = ports();
    const approved = (await p.retrieve(event, { intents: [], locale: "en" })).approvedTimes;
    expect(approved).toEqual(expect.arrayContaining(["09:00-17:00", "09:00", "17:00"]));
  });

  it("loads the context once for the whole turn", async () => {
    let loads = 0;
    const built = createAiTurnPorts({
      providers: {
        utility: stubProvider({}, [], "utility"),
        primary: stubProvider({}, [], "primary")
      },
      models: MODELS,
      loadContext: async () => {
        loads += 1;
        return context;
      }
    });
    await built.understand(event);
    await built.retrieve(event, { intents: [], locale: "en" });
    await built.compose(event, decision());
    expect(loads).toBe(1);
  });
});

describe("composition routes by what classification found", () => {
  it("reads two approved items with the cheap model", async () => {
    // A confident classification, a first message and a small approved set:
    // this is the turn the lookup role exists for.
    const { ports: p, calls } = ports({}, { ...MODELS, lookup: "model-lookup" });
    await p.understand(event);
    await p.compose(event, decision());
    expect(calls.at(-1)).toEqual({ role: "lookup", model: "model-lookup" });
  });

  it("uses the primary model when no lookup model is configured", async () => {
    // The role is still `lookup` - the turn has not changed - but the
    // identifier substitutes upwards, so a deployment that never set
    // AI_MODEL_LOOKUP answers with the better model rather than not at all.
    const { ports: p, calls } = ports();
    await p.understand(event);
    await p.compose(event, decision());
    expect(calls.at(-1)).toEqual({ role: "lookup", model: "model-primary" });
  });

  it("uses the primary model once there is more than a lookup to do", async () => {
    const { ports: p, calls } = ports({
      utility: {
        classification: ok({ intent: "chat", language: "en", confidence: 0.5, highStakes: false })
      }
    });
    await p.understand(event);
    await p.compose(event, decision());
    expect(calls.at(-1)).toEqual({ role: "primary", model: "model-primary" });
  });

  it("says why the role was chosen", async () => {
    // The record the Test Center reads. Without it a cheaper model is a
    // change nobody can account for after the fact.
    const reasons: (readonly string[] | undefined)[] = [];
    const built = createAiTurnPorts({
      providers: {
        utility: stubProvider({}, [], "utility"),
        primary: stubProvider({}, [], "primary")
      },
      models: MODELS,
      loadContext: async () => context,
      onCall: (record) => reasons.push(record.routingReasons)
    });
    await built.understand(event);
    await built.compose(event, decision());
    // The classification call carries none: only the reply is routed.
    expect(reasons).toEqual([undefined, ["direct_lookup_against_approved_knowledge"]]);
  });

  it("escalates only when the stakes and the doubt coincide", async () => {
    // Escalation is reserved, not a fallback for every uncertain turn.
    const { ports: p, calls } = ports({
      utility: {
        classification: ok({ intent: "refund", language: "en", confidence: 0.2, highStakes: true })
      },
      escalation: {}
    });
    await p.understand(event);
    await p.compose(event, decision());
    expect(calls.at(-1)).toEqual({ role: "escalation", model: "model-escalation" });
  });

  it("stays on primary when doubt is high but stakes are not", async () => {
    const { ports: p, calls } = ports({
      utility: {
        classification: ok({ intent: "chat", language: "en", confidence: 0.1, highStakes: false })
      },
      escalation: {}
    });
    await p.understand(event);
    await p.compose(event, decision());
    expect(calls.at(-1)!.role).toBe("primary");
  });

  it("calls no model at all when the turn is resolved without one", async () => {
    const { ports: p, log } = ports();
    await p.understand(event);
    log.length = 0;
    const composed = await p.compose(event, decision("wait"));
    expect(log).toEqual([]);
    expect(composed.text).toBe("");
  });
});

describe("a reply the model disowns is not sent", () => {
  it("returns an empty draft when the model asks for a human", async () => {
    // Empty fails validation, which resolves to a handoff. Sending a reply the
    // model flagged as needing a person would ignore the one signal it gave.
    const { ports: p } = ports({
      primary: { reply: ok({ ...reply, needsHuman: true }) }
    });
    await p.understand(event);
    expect((await p.compose(event, decision())).text).toBe("");
  });

  it("returns an empty draft when generation fails", async () => {
    const { ports: p } = ports({
      primary: { reply: err(appError("PROVIDER_UNAVAILABLE", "429", { retryable: true })) }
    });
    await p.understand(event);
    expect((await p.compose(event, decision())).text).toBe("");
  });

  it("carries the citations through for the validator to check", async () => {
    const { ports: p } = ports();
    await p.understand(event);
    expect((await p.compose(event, decision())).citedRefs).toEqual([FAQ_ID]);
  });
});

describe("only a booking turn may claim completion", () => {
  it("claims completion for a book decision and nothing else", async () => {
    // Derived from the decision, never from the prose: the model has no way to
    // take an action, so no other decision type can honestly have completed one.
    expect(composedFrom(reply, "book").claimsCompletion).toBe(true);
    for (const type of ["answer", "clarify", "qualify", "handoff", "wait"] as const) {
      expect(composedFrom(reply, type).claimsCompletion).toBe(false);
    }
  });

  it("never claims completion on a draft it is handing to a human", () => {
    expect(composedFrom({ ...reply, needsHuman: true }, "book")).toEqual({
      text: "",
      citedRefs: [],
      claimsCompletion: false
    });
  });
});

describe("what an approved FAQ answer approves", () => {
  const withFaq = (answer: string): TurnContext => ({
    requiredFields: [],
    knownFacts: [],
    faqItems: [{ id: "11111111-1111-4111-8111-111111111111", question: "Q", answer }],
    priceItems: [],
    policy: {
      primaryLanguage: "en",
      fallbackLanguage: "en",
      forbiddenClaims: [],
      escalationKeywords: [],
      lowConfidenceThreshold: 0.5
    },
    business: TEST_BUSINESS,
    approvedTimes: [],
    messages: [{ role: "customer", content: "when are you open?" }],
    classification: "webhook",
    demoMode: false,
    priorOutcomes: []
  });

  const retrieveWith = async (answer: string) => {
    const ports = createAiTurnPorts({
      providers: {},
      models: {},
      loadContext: async () => withFaq(answer)
    });
    return ports.retrieve(
      {
        eventId: "e1",
        workspaceId: "w",
        conversationId: "c",
        channel: "whatsapp",
        text: "when are you open?",
        occurredAt: "2026-08-21T10:00:00.000Z"
      },
      { intents: [], locale: "en" }
    );
  };

  it("approves the times inside an approved answer", async () => {
    // The failure this prevents, observed in production: the model cited this
    // exact answer, quoted it verbatim, and the validator blocked the reply for
    // stating times no approved source confirmed - while the source it quoted
    // was itself approved.
    const retrieved = await retrieveWith("We are open Monday to Friday, 09:00 to 18:00.");
    expect(retrieved.approvedTimes).toEqual(expect.arrayContaining(["Monday", "Friday", "18:00"]));
  });

  it("approves money stated in an approved answer", async () => {
    const retrieved = await retrieveWith("Delivery costs 50 TL within the city.");
    expect(retrieved.approvedAmounts).toEqual(expect.arrayContaining(["50 TL"]));
  });

  it("approves nothing extra when the answer states no times or money", async () => {
    // The set must stay tight: this is what stops an unrelated FAQ from
    // silently licensing a figure the workspace never approved.
    const retrieved = await retrieveWith("Yes, we offer gift wrapping on request.");
    expect(retrieved.approvedTimes).toEqual([]);
    expect(retrieved.approvedAmounts).toEqual([]);
  });

  it("still approves business hours supplied by the profile", async () => {
    const ports = createAiTurnPorts({
      providers: {},
      models: {},
      loadContext: async () => ({ ...withFaq("Nothing dated here."), approvedTimes: ["09:00"] })
    });
    const retrieved = await ports.retrieve(
      {
        eventId: "e2",
        workspaceId: "w",
        conversationId: "c",
        channel: "whatsapp",
        text: "hi",
        occurredAt: "2026-08-21T10:00:00.000Z"
      },
      { intents: [], locale: "en" }
    );
    expect(retrieved.approvedTimes).toEqual(["09:00"]);
  });
});
