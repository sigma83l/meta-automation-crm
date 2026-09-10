import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeRow } from "@/tests/fixtures/fake-supabase";
import { DIALECTS } from "@/src/modules/ai/providers/dialects";
import { createHttpAiProvider } from "@/src/modules/ai/providers/http-provider";
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
import { CLINIC, GOLDEN_CASES, type GoldenCase } from "./fixtures";

/**
 * The golden set: real prompts, a real model, scored against what the reply is
 * allowed to be.
 *
 * C-013 recorded this as blocked because scoring real prompts needs a live
 * model, and asserting outputs against a model nobody had chosen would be
 * theatre. A provider has now been chosen, so the block is lifted.
 *
 * What this asserts is deliberately not "the reply reads well". Model output
 * varies between runs, and a test that pins prose is a test that fails on
 * paraphrase. It asserts the properties the system actually promises: that a
 * question covered by approved knowledge gets answered from that knowledge,
 * that everything else reaches a person, and that a forbidden claim never
 * appears in text a customer would receive.
 *
 * Opt-in. Without a real key it skips rather than failing, because a missing
 * credential is not a regression, and because it costs money and latency that
 * do not belong in the default suite.
 */

const apiKey = process.env.PLATFORM_GEMINI_API_KEY;
const utilityModel = process.env.AI_MODEL_UTILITY;
const primaryModel = process.env.AI_MODEL_PRIMARY;
const configured =
  Boolean(apiKey && utilityModel && primaryModel) && !apiKey?.startsWith("replace");

/**
 * Space between cases.
 *
 * Two model calls per case against a free tier is enough to hit a per-minute
 * quota partway through the set, which surfaces as `rate_limit` on whichever
 * cases happen to run last - a result that says nothing about grounding and
 * moves around between runs. Pacing costs wall-clock and buys a set whose
 * failures mean what they say.
 */
const PACE_MS = 6_000;

const WORKSPACE = "99999999-9999-4999-8999-999999999999";
const CONVERSATION = "88888888-8888-4888-8888-888888888888";
const CUSTOMER = "77777777-7777-4777-8777-777777777777";

const tables = (): Record<string, FakeRow[]> => ({
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
  ai_execution_audit_events: []
});

type Outcome = Readonly<{
  outcome: string;
  reasonCodes: readonly string[];
  reply: string;
  /** Ids the model said it relied on, whether or not the turn was sent. */
  cited: readonly string[];
  calls: readonly ModelCallRecord[];
}>;

async function runCase(testCase: GoldenCase, eventId: string): Promise<Outcome> {
  const fake = createFakeSupabase({ tables: tables() });
  const drafts = createDraftRegistry();
  const calls: ModelCallRecord[] = [];

  // A fresh provider per role, exactly as turn-runtime builds them, so the
  // model each role uses is the one the environment names.
  const provider = (model: string) =>
    createHttpAiProvider({
      dialect: DIALECTS.gemini,
      apiKey: apiKey!,
      model,
      // The production value. A case that gives up sooner than production
      // would turns a slow-but-successful turn into a skip, and a case that
      // gives up later reports a timeout production would never have seen.
      timeoutMs: 45_000
    });

  const context: TurnContext = {
    ...(testCase.context ?? CLINIC),
    messages: [{ role: "customer", content: testCase.message }]
  };

  const aiPorts = createAiTurnPorts({
    providers: { utility: provider(utilityModel!), primary: provider(primaryModel!) },
    models: { utility: utilityModel!, primary: primaryModel! },
    loadContext: async () => context,
    onCall: (record) => void calls.push(record)
  });

  const durable = createSupabaseTurnPorts({
    admin: fake.client,
    subject: { customerId: CUSTOMER, recipientRef: "900000000000", connectionMode: "sandbox" },
    send: { liveSendEnabled: false, recipientAllowlist: [], explicitApproval: false },
    decisionContext: async () => ({
      escalationKeywords: CLINIC.policy.escalationKeywords,
      lowConfidenceThreshold: CLINIC.policy.lowConfidenceThreshold
    }),
    draft: (id) => drafts.get(id),
    modelCalls: () => calls
  });

  // Captured from compose rather than read back from the outbound row: a
  // refused draft is never written, and "what did it say and what did it rest
  // on" is exactly the question a blocked case raises.
  let composed: Readonly<{ text: string; citedRefs: readonly string[] }> = {
    text: "",
    citedRefs: []
  };

  const ports: TurnPorts = {
    ...durable,
    ...aiPorts,
    async compose(turn, decision) {
      const reply = await aiPorts.compose(turn, decision);
      composed = { text: reply.text, citedRefs: reply.citedRefs };
      drafts.record(turn.eventId, reply);
      return reply;
    }
  };

  const event: TurnEvent = {
    eventId,
    workspaceId: WORKSPACE,
    conversationId: CONVERSATION,
    channel: "whatsapp",
    text: testCase.message,
    occurredAt: new Date().toISOString()
  };

  const record = await runTurn(event, ports);
  const outbound = fake.database.rows("messages").find((row) => row.direction === "outbound") as
    { body?: string } | undefined;

  return {
    outcome: record.outcome,
    reasonCodes: record.reasonCodes,
    reply: outbound?.body ?? "",
    cited: composed.citedRefs,
    calls
  };
}

describe.runIf(configured)("golden set: what the assistant may and may not say", () => {
  for (const testCase of GOLDEN_CASES) {
    it(`${testCase.expect === "answers" ? "answers" : "hands off"}: ${testCase.name}`, async (runner) => {
      await new Promise((resolve) => setTimeout(resolve, PACE_MS));
      const result = await runCase(testCase, `golden-${testCase.name}`);

      // A model or network failure is not a grounding verdict. Failing the
      // case on it would report a provider outage as a safety regression.
      const failed = result.calls.filter((call) => call.outcome === "failed");

      // A transport failure means the case did not run, not that it ran and
      // was wrong. Rate limits were already skipped for that reason; timeouts
      // and outages are the same statement and were not, so a free-tier stall
      // reported as five red cases that read like a safety regression. What is
      // deliberately *not* skipped is `authentication` and `invalid_output`: a
      // rejected key and an off-contract reply are real findings about this
      // repository, not weather.
      //
      // Skipping keeps a red result meaning "the assistant said something it
      // should not have", which is the only thing anyone should read this
      // suite for.
      const DID_NOT_RUN: readonly string[] = ["rate_limit", "timeout", "unavailable"];
      if (failed.some((call) => DID_NOT_RUN.includes(call.failureKind ?? ""))) {
        runner.skip();
        return;
      }

      expect(
        `${testCase.name}: model calls failed -> ${failed.map((f) => f.failureKind).join(",")}`
      ).toBe(`${testCase.name}: model calls failed -> `);

      if (testCase.expect === "answers") {
        expect(`${testCase.name} -> ${result.outcome} [${result.reasonCodes.join(",")}]`).toBe(
          `${testCase.name} -> sent [answer_from_knowledge]`
        );
        expect(result.reply.length).toBeGreaterThan(0);

        // Declared by every answering case since the set was written, and
        // asserted by none of them: without this, "it answered" and "it
        // answered from the right approved item" were the same green.
        if (testCase.citesOneOf) {
          const hit = result.cited.some((ref) => testCase.citesOneOf!.includes(ref));
          expect(`${testCase.name} cited one of the expected items: ${hit}`).toBe(
            `${testCase.name} cited one of the expected items: true`
          );
        }

        // The approved value itself, reproduced. A reply that is fluent, cites
        // correctly and states a different number is the failure grounding is
        // meant to exclude, and nothing above would catch it.
        for (const required of testCase.mustContain ?? []) {
          expect(
            `${testCase.name} reply contains "${required}": ${result.reply
              .toLowerCase()
              .includes(required.toLowerCase())}`
          ).toBe(`${testCase.name} reply contains "${required}": true`);
        }
      } else {
        // Anything that is not `sent` kept the reply away from the customer,
        // which is the property under test. Which safe outcome it took is a
        // detail of the block, not of the promise.
        expect(`${testCase.name} -> sent? ${result.outcome === "sent"}`).toBe(
          `${testCase.name} -> sent? false`
        );
      }

      for (const banned of testCase.mustNotContain ?? []) {
        expect(
          `${testCase.name} reply contains "${banned}": ${result.reply
            .toLowerCase()
            .includes(banned.toLowerCase())}`
        ).toBe(`${testCase.name} reply contains "${banned}": false`);
      }
      // Two calls at the production timeout, plus the pacing delay.
    }, 150_000);
  }
});

describe.runIf(!configured)("golden set", () => {
  it("skips without a configured model", () => {
    expect(configured).toBe(false);
  });
});
