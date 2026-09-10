import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeRow } from "@/tests/fixtures/fake-supabase";
import { createDeterministicAiProvider } from "@/src/modules/ai/providers/deterministic-provider";
import type { AiProvider } from "@/src/modules/ai/contracts";
import {
  createAiTurnPorts,
  type ModelCallRecord,
  type TurnContext
} from "@/src/modules/rcos/ai-turn-ports";
import {
  createDraftRegistry,
  createSupabaseTurnPorts
} from "@/src/modules/rcos/supabase-turn-ports";
import { runTurn, type TurnEvent, type TurnPorts } from "@/src/modules/rcos/turn-engine";
import { TEST_BUSINESS } from "@/tests/fixtures/business-voice";

/**
 * One turn, start to finish, over the real engine and the real ports.
 *
 * Every other test in this area exercises one half: the engine against injected
 * doubles, or a port against a fake database. Neither can answer the question
 * this file exists for — what actually happens to a customer's message — and
 * that question has two answers worth pinning down, because in every current
 * environment the second one is the live behaviour: a workspace with no model
 * configured must reach a person rather than send anything.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const PRICE = "44444444-4444-4444-8444-444444444444";

const event: TurnEvent = {
  eventId: "evt-1",
  workspaceId: WORKSPACE,
  conversationId: CONVERSATION,
  channel: "whatsapp",
  text: "how much is a consultation?",
  occurredAt: "2026-08-19T10:00:00.000Z"
};

const context: TurnContext = {
  requiredFields: [],
  knownFacts: [],
  faqItems: [],
  priceItems: [
    {
      id: PRICE,
      name: "Consultation",
      amountMinor: 120000,
      currency: "TL",
      availability: "available"
    }
  ],
  policy: {
    primaryLanguage: "en",
    fallbackLanguage: "en",
    forbiddenClaims: [],
    escalationKeywords: [],
    lowConfidenceThreshold: 0.5
  },
  business: TEST_BUSINESS,
  approvedTimes: [],
  messages: [{ role: "customer", content: event.text }],
  classification: "webhook",
  demoMode: false,
  priorOutcomes: []
};

const tables = (over: Partial<Record<string, FakeRow[]>> = {}): Record<string, FakeRow[]> => ({
  conversations: [
    {
      id: CONVERSATION,
      workspace_id: WORKSPACE,
      customer_id: CUSTOMER,
      state: "open",
      owner: "automation",
      requires_human_review: false
    }
  ],
  workspace_subscriptions: [
    {
      workspace_id: WORKSPACE,
      status: "trialing",
      trial_ends_at: "2099-01-01T00:00:00.000Z",
      current_period_ends_at: null
    }
  ],
  turn_records: [],
  messages: [],
  ai_execution_audit_events: [],
  ...over
});

function pipeline(
  over: Partial<{
    provider: AiProvider | undefined;
    models: Readonly<{ utility?: string; primary?: string }>;
    tables: Record<string, FakeRow[]>;
    turnContext: TurnContext;
  }> = {}
) {
  const fake = createFakeSupabase({ tables: over.tables ?? tables() });
  const drafts = createDraftRegistry();
  const provider = "provider" in over ? over.provider : createDeterministicAiProvider();

  const aiPorts = createAiTurnPorts({
    providers: provider ? { utility: provider, primary: provider } : {},
    models: over.models ?? { utility: "test-utility", primary: "test-primary" },
    loadContext: async () => over.turnContext ?? context
  });

  const durable = createSupabaseTurnPorts({
    admin: fake.client,
    subject: { customerId: CUSTOMER, recipientRef: "905551112233", connectionMode: "sandbox" },
    send: { liveSendEnabled: false, recipientAllowlist: [], explicitApproval: false },
    decisionContext: async () => ({
      escalationKeywords: (over.turnContext ?? context).policy.escalationKeywords,
      lowConfidenceThreshold: (over.turnContext ?? context).policy.lowConfidenceThreshold
    }),
    draft: (id) => drafts.get(id)
  });

  const ports: TurnPorts = {
    ...durable,
    ...aiPorts,
    async compose(turn, decision) {
      const reply = await aiPorts.compose(turn, decision);
      drafts.record(turn.eventId, reply);
      return reply;
    }
  };

  return { fake, ports };
}

describe("a turn that can be answered", () => {
  it("composes, validates, commits and stores the reply as prepared", async () => {
    const { fake, ports } = pipeline();
    const record = await runTurn(event, ports);

    expect(record.outcome).toBe("sent");
    const messages = fake.database.rows("messages");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ direction: "outbound", status: "prepared" });
    expect(fake.database.rows("turn_records")).toHaveLength(1);
  });

  it("does not send twice when the same event arrives again", async () => {
    const { fake, ports } = pipeline();
    await runTurn(event, ports);
    const second = await runTurn(event, ports);

    expect(second.outcome).toBe("duplicate");
    // Deduplication is at step 1, so the second delivery costs no model call
    // and produces no second reply.
    expect(fake.database.rows("messages")).toHaveLength(1);
  });
});

describe("a workspace with no model configured", () => {
  // The live state of every environment in this repository today: no
  // AI_MODEL_* identifiers, and placeholder platform keys.
  it("reaches a person instead of sending anything", async () => {
    const { fake, ports } = pipeline({ models: {} });
    const record = await runTurn(event, ports);

    expect(record.outcome).toBe("handoff");
    expect(record.reasonCodes).toContain("empty_draft");
    expect(fake.database.rows("messages")).toHaveLength(0);
    expect(fake.database.rows("conversations")[0]!.requires_human_review).toBe(true);
  });

  it("still records the turn, so the silence is explainable", async () => {
    const { fake, ports } = pipeline({ models: {} });
    await runTurn(event, ports);
    expect(fake.database.rows("turn_records")[0]).toMatchObject({ outcome: "handoff" });
    expect(fake.database.rows("ai_execution_audit_events")).toHaveLength(1);
  });
});

describe("a provider that is down", () => {
  it("takes the same route as an unconfigured one", async () => {
    const { fake, ports } = pipeline({
      provider: createDeterministicAiProvider({ failure: "timeout" })
    });
    const record = await runTurn(event, ports);

    // One route to safety, reached by every cause. A separate path per failure
    // is a path only the tested failures take.
    expect(record.outcome).toBe("handoff");
    expect(fake.database.rows("messages")).toHaveLength(0);
  });
});

describe("a workspace with no usable credential", () => {
  it("hands off rather than throwing the job", async () => {
    const { ports } = pipeline({ provider: undefined });
    const record = await runTurn(event, ports);
    expect(record.outcome).toBe("handoff");
  });
});

/** The providers are frozen, so calls are counted by wrapping rather than spying. */
function countingProvider(): { provider: AiProvider; calls: () => number } {
  const inner = createDeterministicAiProvider();
  let calls = 0;
  const provider: AiProvider = {
    ...inner,
    classifyTurn: (input) => {
      calls += 1;
      return inner.classifyTurn(input);
    },
    generateStructuredReply: (input) => {
      calls += 1;
      return inner.generateStructuredReply(input);
    }
  };
  return { provider, calls: () => calls };
}

describe("a conversation a person has taken", () => {
  it("is refused before the model is ever asked", async () => {
    const { provider, calls } = countingProvider();

    const { fake, ports } = pipeline({
      provider,
      tables: tables({
        conversations: [
          {
            id: CONVERSATION,
            workspace_id: WORKSPACE,
            customer_id: CUSTOMER,
            state: "open",
            owner: "human",
            requires_human_review: false
          }
        ]
      })
    });
    const record = await runTurn(event, ports);

    expect(record.outcome).toBe("policy_blocked");
    expect(record.reasonCodes).toEqual(["human_takeover"]);
    // Policy runs before understanding for cost as well as for privacy: a
    // blocked conversation should not be read any further than necessary.
    expect(calls()).toBe(0);
    expect(fake.database.rows("messages")).toHaveLength(0);
  });
});

describe("a reply quoting a price", () => {
  it("passes validation because retrieval offered that exact figure", async () => {
    // The prompt and the approved list are rendered by one function, so the
    // price the model sees is the price the validator approves. If those ever
    // diverged, every reply quoting a price would be blocked.
    const { fake, ports } = pipeline({
      turnContext: {
        ...context,
        faqItems: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            question: "How much is a consultation?",
            answer: "A consultation is 1200.00 TL."
          }
        ]
      }
    });
    const record = await runTurn(event, ports);

    expect(record.outcome).toBe("sent");
    expect(fake.database.rows("messages")[0]!.body).toBe("A consultation is 1200.00 TL.");
  });
});

describe("telling the three causes of an empty draft apart", () => {
  // All three reach the same outcome by design - one route to safety. What
  // differs is who has to act: an unconfigured model is the operator's, a
  // failed call is the provider's, and a model asking for a person is nobody's,
  // because that is the system working. The turn record cannot express that
  // difference; these records are where it survives.
  function recordingPipeline(
    over: Parameters<typeof pipeline>[0] & {
      models?: Readonly<{ utility?: string; primary?: string }>;
    }
  ) {
    const calls: ModelCallRecord[] = [];
    const fake = createFakeSupabase({ tables: tables() });
    const drafts = createDraftRegistry();
    const provider = "provider" in over ? over.provider : createDeterministicAiProvider();

    const aiPorts = createAiTurnPorts({
      providers: provider ? { utility: provider, primary: provider } : {},
      models: over.models ?? { utility: "test-utility", primary: "test-primary" },
      loadContext: async () => over.turnContext ?? context,
      onCall: (record) => void calls.push(record)
    });
    const durable = createSupabaseTurnPorts({
      admin: fake.client,
      subject: { customerId: CUSTOMER, recipientRef: "905551112233", connectionMode: "sandbox" },
      send: { liveSendEnabled: false, recipientAllowlist: [], explicitApproval: false },
      decisionContext: async () => ({
        escalationKeywords: [],
        lowConfidenceThreshold: (over.turnContext ?? context).policy.lowConfidenceThreshold
      }),
      draft: (id) => drafts.get(id),
      modelCalls: () => calls
    });
    const ports: TurnPorts = {
      ...durable,
      ...aiPorts,
      async compose(turn, decision) {
        const reply = await aiPorts.compose(turn, decision);
        drafts.record(turn.eventId, reply);
        return reply;
      }
    };
    return { fake, ports, calls };
  }

  it("reports skipped, naming the missing configuration, when no model is set", async () => {
    const { ports, calls } = recordingPipeline({ models: {} });
    const record = await runTurn(event, ports);

    expect(record.outcome).toBe("handoff");
    expect(calls.every((call) => call.outcome === "skipped")).toBe(true);
    expect(calls[0]?.failureCode).toBe("CONFIGURATION_MISSING");
  });

  it("reports failed, with the error class, when the provider refuses", async () => {
    const { ports, calls } = recordingPipeline({
      provider: createDeterministicAiProvider({ failure: "timeout" })
    });
    const record = await runTurn(event, ports);

    expect(record.outcome).toBe("handoff");
    expect(calls.some((call) => call.outcome === "failed")).toBe(true);
    expect(calls.find((call) => call.outcome === "failed")?.failureCode).toBe(
      "PROVIDER_UNAVAILABLE"
    );
  });

  it("reports ok and deferredToHuman when the model itself asks for a person", async () => {
    // No FAQ and no prices, so the fixture has nothing approved to cite and
    // sets needsHuman. The call succeeded; the answer was "ask a human".
    const { ports, calls } = recordingPipeline({
      turnContext: { ...context, faqItems: [], priceItems: [] }
    });
    const record = await runTurn(event, ports);

    expect(record.outcome).toBe("handoff");
    const compose = calls.find((call) => call.role !== "utility");
    expect(compose?.outcome).toBe("ok");
    expect(compose?.deferredToHuman).toBe(true);
  });

  it("puts the calls in the audit row without any message text", async () => {
    const { fake, ports } = recordingPipeline({ models: {} });
    await runTurn(event, ports);

    const audit = fake.database.rows("ai_execution_audit_events")[0];
    const serialised = JSON.stringify(audit);
    expect(serialised).toContain("modelCalls");
    expect(serialised).toContain("skipped");
    // The customer's words must never reach an audit table.
    expect(serialised).not.toContain("consultation");
  });
});
