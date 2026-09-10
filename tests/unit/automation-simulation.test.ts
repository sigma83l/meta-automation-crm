import { describe, expect, it } from "vitest";

import { instrumentPorts, verdictFor } from "@/src/modules/automations/server/simulation-trace";
import { SIMULATION_STEPS } from "@/src/modules/automations/simulation-contracts";
import {
  runTurn,
  type ComposedReply,
  type TurnDecision,
  type TurnEvent,
  type TurnPorts
} from "@/src/modules/rcos/turn-engine";

const event: TurnEvent = {
  eventId: "evt-1",
  workspaceId: "ws-1",
  conversationId: "conv-1",
  channel: "whatsapp",
  text: "how much is a cut and are you open sunday?",
  occurredAt: "2026-09-06T10:00:00.000Z"
};

const reply = (over: Partial<ComposedReply> = {}): ComposedReply => ({
  text: "A cut is 1200 TL.",
  citedRefs: ["price-1"],
  claimsCompletion: false,
  ...over
});

const decision = (over: Partial<TurnDecision> = {}): TurnDecision => ({
  type: "answer",
  priority: "p1_explicit_request",
  reasonCodes: ["direct_answer"],
  ...over
});

/**
 * Ports that would happily send. Each write port records that it was called so
 * a test can prove the instrumented copies never delegate to them.
 */
function realPorts(over: Partial<TurnPorts> = {}) {
  const writes: string[] = [];
  const ports: TurnPorts = {
    isNewEvent: async () => true,
    hydrate: async () => ({ facts: [] }),
    evaluatePolicy: async () => ({ canSend: true, allowedActions: [] }),
    understand: async () => ({
      intents: [{ name: "price_request", confidence: 0.9 }],
      locale: "en"
    }),
    retrieve: async () => ({
      facts: [{ ref: "price-1", value: "1200 TL" }],
      approvedAmounts: ["1200 TL"],
      approvedTimes: []
    }),
    decide: async () => decision(),
    executeTool: async () => ({ authoritative: true, summary: "done" }),
    compose: async () => reply(),
    persistFacts: async () => {
      writes.push("persistFacts");
      return 1;
    },
    commit: async () => void writes.push("commit"),
    send: async () => void writes.push("send"),
    observe: async () => void writes.push("observe"),
    sentRefs: async () => [],
    ...over
  };
  return { ports, writes };
}

describe("test centre simulation", () => {
  it("reports every one of the twelve steps, in engine order", async () => {
    const { ports } = realPorts();
    const instrumented = instrumentPorts(ports, { subject: "conversation" });
    await runTurn(event, instrumented.ports);

    const steps = instrumented.steps();
    expect(steps).toHaveLength(SIMULATION_STEPS.length);
    expect(steps.map((step) => step.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("never delegates to a write port, even on a turn that would send", async () => {
    const { ports, writes } = realPorts();
    const instrumented = instrumentPorts(ports, { subject: "conversation" });

    const record = await runTurn(event, instrumented.ports);

    expect(record.outcome).toBe("sent");
    expect(verdictFor(record.outcome)).toBe("would_send");
    // The turn reached commit and send, and neither touched the real port.
    expect(writes).toEqual([]);
    expect(instrumented.wouldSend()).toEqual({
      text: "A cut is 1200 TL.",
      sendRef: "conv-1:evt-1"
    });
  });

  it("marks the steps a blocked turn never reached as skipped", async () => {
    const { ports, writes } = realPorts({
      evaluatePolicy: async () => ({
        canSend: false,
        allowedActions: [],
        blockedReason: "human_takeover"
      })
    });
    const instrumented = instrumentPorts(ports, { subject: "conversation" });

    const record = await runTurn(event, instrumented.ports);
    const byId = new Map(instrumented.steps().map((step) => [step.id, step]));

    expect(verdictFor(record.outcome)).toBe("would_block");
    expect(byId.get("policy")?.status).toBe("blocked");
    expect(byId.get("policy")?.detail).toContain("human_takeover");
    // Step 4 stops the turn, so no model is ever called - which is the property
    // worth showing an operator, not an absence to paper over.
    expect(byId.get("understand")?.status).toBe("skipped");
    expect(byId.get("compose")?.status).toBe("skipped");
    expect(byId.get("commit")?.status).toBe("skipped");
    // Step 12 runs for every outcome, including a refusal.
    expect(byId.get("observe")?.status).toBe("ran");
    expect(writes).toEqual([]);
    expect(instrumented.wouldSend()).toBeUndefined();
  });

  it("uses the stipulated policy instead of the real port for a synthetic run", async () => {
    const { ports } = realPorts({
      evaluatePolicy: async () => ({
        canSend: false,
        allowedActions: [],
        blockedReason: "conversation_missing"
      })
    });
    const instrumented = instrumentPorts(ports, {
      subject: "synthetic",
      policy: async () => ({ canSend: true, allowedActions: [] })
    });

    const record = await runTurn(event, instrumented.ports);
    const policyStep = instrumented.steps().find((step) => step.id === "policy");

    // The real port would have answered `conversation_missing` and stopped the
    // turn at step 4. The stipulation is what lets steps 5-12 be exercised.
    expect(record.outcome).toBe("sent");
    expect(policyStep?.status).toBe("stipulated");
    expect(policyStep?.detail).toContain("stipulated");
  });

  it("keeps a refused draft visible so the operator can see what was rejected", async () => {
    // Cites a ref that retrieval never returned, which the validator refuses.
    const { ports, writes } = realPorts({
      compose: async () => reply({ text: "It is 999 TL.", citedRefs: ["invented-ref"] })
    });
    const instrumented = instrumentPorts(ports, { subject: "conversation" });

    const record = await runTurn(event, instrumented.ports);

    expect(record.outcome).not.toBe("sent");
    expect(instrumented.draft()).toEqual({ text: "It is 999 TL.", citedRefs: ["invented-ref"] });
    expect(instrumented.wouldSend()).toBeUndefined();
    expect(writes).toEqual([]);
  });

  it("recovers the validator's own words for a refusal", async () => {
    // The engine keeps only the failure codes, so the token that actually
    // caused the block -- the whole question an operator is asking -- was being
    // discarded. Recomputed from the same pure validator over the same inputs.
    const { ports } = realPorts({
      compose: async () => reply({ text: "We open Saturday at 9am.", citedRefs: ["price-1"] })
    });
    const instrumented = instrumentPorts(ports, { subject: "conversation" });

    const record = await runTurn(event, instrumented.ports);
    const detail = instrumented.validationDetail(record.reasonCodes);

    expect(record.reasonCodes).toContain("unverified_time");
    expect(detail?.join(" ")).toContain("Saturday");
  });

  it("withholds the detail when its reconstruction disagrees with the engine", async () => {
    // A tool changes `hasAuthoritativeResult`, which this reconstruction cannot
    // see. Reporting a confident reason derived from the wrong context is worse
    // than reporting none.
    const { ports } = realPorts({
      decide: async () =>
        decision({
          toolRequest: {
            actionName: "book",
            actionClass: "reversible_low_risk",
            idempotencyKey: "k1",
            hasHumanApproval: true
          }
        })
    });
    const instrumented = instrumentPorts(ports, { subject: "conversation" });
    const record = await runTurn(event, instrumented.ports);
    expect(instrumented.validationDetail(record.reasonCodes)).toBeUndefined();
  });

  it("does not invent a memory failure when facts would have been stored", async () => {
    const { ports } = realPorts({
      decide: async () =>
        decision({
          memoryWrites: [
            {
              key: "preferred_time",
              value: "sunday",
              confidence: "confirmed",
              sourceRef: "evt-1",
              recordedAt: "2026-09-06T10:00:00.000Z",
              validUntil: null
            }
          ]
        })
    });
    const instrumented = instrumentPorts(ports, { subject: "conversation" });

    const record = await runTurn(event, instrumented.ports);

    // A neutralised persistFacts that returned 0 would make the engine append
    // `memory_write_failed` - a failure the simulation invented rather than one
    // production would produce.
    expect(record.reasonCodes).not.toContain("memory_write_failed");
    expect(record.acceptedMemoryWrites).toBe(1);

    // Step 3 is written twice - on read, then on the write that would have
    // happened. The second must not erase the first, or the row stops saying
    // what the turn actually knew going in.
    const memoryStep = instrumented.steps().find((step) => step.id === "memory");
    expect(memoryStep?.detail).toContain("No remembered facts for this contact.");
    expect(memoryStep?.detail).toContain("1 new fact would be stored");
  });

  it("keeps the committed outcome when the turn goes on to send", async () => {
    // Step 11 is written twice as well, and the send message replaced the
    // commit message rather than adding to it - so a sending turn showed the
    // ordering guarantee and lost the outcome it had committed.
    const { ports } = realPorts();
    const instrumented = instrumentPorts(ports, { subject: "conversation" });
    await runTurn(event, instrumented.ports);

    const commitStep = instrumented.steps().find((step) => step.id === "commit");
    expect(commitStep?.detail).toContain("Would commit outcome sent");
    expect(commitStep?.detail).toContain("Would then send exactly once");
  });

  it("says the send step was not reached when the validator refused", async () => {
    // The other half: a refused turn commits and stops, and the row has to say
    // so rather than leaving a reader to infer it from an absent sentence.
    const { ports } = realPorts({ compose: async () => reply({ text: "" }) });
    const instrumented = instrumentPorts(ports, { subject: "conversation" });
    await runTurn(event, instrumented.ports);

    const commitStep = instrumented.steps().find((step) => step.id === "commit");
    expect(commitStep?.detail).toContain("Would commit outcome handoff");
    expect(commitStep?.detail).toContain("The send step was not reached");
  });

  it("says how much approved knowledge the reply was checked against", async () => {
    // "Reply checked against approved knowledge" was true of every run and
    // told an operator nothing. The counts separate a refusal from a workspace
    // with nothing approved from a refusal despite six approved items, which
    // have different fixes.
    const { ports } = realPorts();
    const instrumented = instrumentPorts(ports, { subject: "conversation" });
    await runTurn(event, instrumented.ports);

    const validateStep = instrumented.steps().find((step) => step.id === "validate");
    expect(validateStep?.detail).toContain("1 approved fact(s)");
    expect(validateStep?.detail).toContain("1 price(s)");
    expect(validateStep?.detail).toContain("0 prior send(s)");
  });
});
