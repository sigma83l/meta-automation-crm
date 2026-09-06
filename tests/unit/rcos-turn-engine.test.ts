import { describe, expect, it } from "vitest";
import type { ProposedFact } from "@/src/modules/rcos/memory-policy";
import {
  DECISION_PRIORITIES,
  highestPriority,
  outranks,
  runTurn,
  type ComposedReply,
  type TurnDecision,
  type TurnEvent,
  type TurnPorts,
  type TurnRecord
} from "@/src/modules/rcos/turn-engine";

const event: TurnEvent = {
  eventId: "wamid.1",
  workspaceId: "ws-1",
  conversationId: "conv-1",
  channel: "whatsapp",
  text: "how much is a cut?",
  occurredAt: "2026-08-15T10:00:00.000Z"
};

const decision = (over: Partial<TurnDecision> = {}): TurnDecision => ({
  type: "answer",
  priority: "p1_explicit_request",
  reasonCodes: ["direct_answer"],
  ...over
});

const reply = (over: Partial<ComposedReply> = {}): ComposedReply => ({
  text: "A cut is 1200 TL.",
  citedRefs: ["price-1"],
  claimsCompletion: false,
  ...over
});

/** Records which steps ran, so ordering can be asserted rather than assumed. */
function ports(over: Partial<TurnPorts> = {}) {
  const calls: string[] = [];
  const filed: ProposedFact[] = [];
  const sent: string[] = [];
  const committed: TurnRecord[] = [];
  const observed: TurnRecord[] = [];
  const base: TurnPorts = {
    async isNewEvent() {
      calls.push("isNewEvent");
      return true;
    },
    async hydrate() {
      calls.push("hydrate");
      return { facts: [] };
    },
    async evaluatePolicy() {
      calls.push("evaluatePolicy");
      return { canSend: true, allowedActions: ["read", "book_slot"] };
    },
    async understand() {
      calls.push("understand");
      return { intents: [{ name: "pricing", confidence: 0.9 }], locale: "en" };
    },
    async retrieve() {
      calls.push("retrieve");
      return {
        facts: [{ ref: "price-1", value: "1200 TL" }],
        approvedAmounts: ["1200 TL"],
        approvedTimes: []
      };
    },
    async decide() {
      calls.push("decide");
      return decision();
    },
    async executeTool() {
      calls.push("executeTool");
      return { authoritative: true, summary: "booked" };
    },
    async compose() {
      calls.push("compose");
      return reply();
    },
    async persistFacts(_event, facts) {
      calls.push("persistFacts");
      filed.push(...facts);
      return facts.length;
    },
    async commit(record) {
      calls.push("commit");
      committed.push(record);
    },
    async send(_reply, sendRef) {
      calls.push("send");
      sent.push(sendRef);
    },
    async observe(record) {
      calls.push("observe");
      observed.push(record);
    },
    async sentRefs() {
      return [];
    },
    ...over
  };
  return { ports: base, calls, filed, sent, committed, observed };
}

describe("the happy path", () => {
  it("sends once and records the turn", async () => {
    const harness = ports();
    const record = await runTurn(event, harness.ports);
    expect(record.outcome).toBe("sent");
    expect(harness.sent).toHaveLength(1);
  });

  it("commits before sending", async () => {
    // The other order can produce a message the system has no record of, which
    // is unrecoverable; a duplicate send is at least detectable.
    const harness = ports();
    await runTurn(event, harness.ports);
    expect(harness.calls.indexOf("commit")).toBeLessThan(harness.calls.indexOf("send"));
  });

  it("observes every turn", async () => {
    const harness = ports();
    await runTurn(event, harness.ports);
    expect(harness.observed).toHaveLength(1);
  });
});

describe("deduplication comes first", () => {
  it("does nothing at all for an event already handled", async () => {
    const harness = ports({
      async isNewEvent() {
        return false;
      }
    });
    const record = await runTurn(event, harness.ports);
    expect(record.outcome).toBe("duplicate");
    // A provider retry must cost nothing: no model call, no retrieval, no send.
    expect(harness.calls).not.toContain("understand");
    expect(harness.calls).not.toContain("retrieve");
    expect(harness.sent).toHaveLength(0);
  });

  it("still observes a duplicate", async () => {
    const harness = ports({
      async isNewEvent() {
        return false;
      }
    });
    await runTurn(event, harness.ports);
    expect(harness.observed).toHaveLength(1);
  });
});

describe("policy precedes the model", () => {
  it("never reaches a model when sending is blocked", async () => {
    // Both a cost property and a privacy one: a blocked conversation should not
    // be read further than necessary.
    const harness = ports({
      async evaluatePolicy() {
        return { canSend: false, allowedActions: [], blockedReason: "consent_withdrawn" };
      }
    });
    const record = await runTurn(event, harness.ports);
    expect(record.outcome).toBe("policy_blocked");
    expect(record.reasonCodes).toEqual(["consent_withdrawn"]);
    expect(harness.calls).not.toContain("understand");
    expect(harness.sent).toHaveLength(0);
  });
});

describe("tool safety", () => {
  it("refuses a transaction with no idempotency key and never runs it", async () => {
    const harness = ports({
      async decide() {
        return decision({
          type: "book",
          toolRequest: { actionName: "book_slot", actionClass: "business_transaction" }
        });
      }
    });
    const record = await runTurn(event, harness.ports);
    expect(record.outcome).toBe("tool_refused");
    expect(harness.calls).not.toContain("executeTool");
    expect(harness.sent).toHaveLength(0);
  });

  it("refuses a tool the policy never granted", async () => {
    const harness = ports({
      async evaluatePolicy() {
        return { canSend: true, allowedActions: ["read"] };
      },
      async decide() {
        return decision({
          type: "book",
          toolRequest: {
            actionName: "book_slot",
            actionClass: "business_transaction",
            idempotencyKey: "key-1"
          }
        });
      }
    });
    const record = await runTurn(event, harness.ports);
    expect(record.outcome).toBe("tool_refused");
    expect(harness.calls).not.toContain("executeTool");
  });

  it("hands off rather than claiming a booking the tool did not confirm", async () => {
    const harness = ports({
      async decide() {
        return decision({
          type: "book",
          toolRequest: {
            actionName: "book_slot",
            actionClass: "business_transaction",
            idempotencyKey: "key-1"
          }
        });
      },
      async executeTool() {
        return { authoritative: false, summary: "provider timed out" };
      },
      async compose() {
        return reply({ text: "You're booked.", citedRefs: [], claimsCompletion: true });
      }
    });
    const record = await runTurn(event, harness.ports);
    expect(record.outcome).toBe("handoff");
    expect(record.reasonCodes).toContain("unclaimed_success");
    expect(harness.sent).toHaveLength(0);
  });
});

describe("validation blocks the send", () => {
  it("does not send a reply quoting an unapproved price", async () => {
    const harness = ports({
      async compose() {
        return reply({ text: "Special today: 300 TL only.", citedRefs: [] });
      }
    });
    const record = await runTurn(event, harness.ports);
    expect(record.outcome).toBe("handoff");
    expect(harness.sent).toHaveLength(0);
  });

  it("still commits a refused turn", async () => {
    // The reason has to survive for whoever picks up the handoff.
    const harness = ports({
      async compose() {
        return reply({ text: "Only 99 TL!", citedRefs: [] });
      }
    });
    await runTurn(event, harness.ports);
    expect(harness.committed).toHaveLength(1);
    expect(harness.committed[0]?.reasonCodes).toContain("unverified_money");
  });

  it("refuses to send twice for the same event", async () => {
    const harness = ports({
      async sentRefs() {
        return ["conv-1:wamid.1"];
      }
    });
    const record = await runTurn(event, harness.ports);
    expect(record.outcome).toBe("safe_acknowledgement");
    expect(harness.sent).toHaveLength(0);
  });
});

describe("memory writes are filtered by policy", () => {
  const budget: ProposedFact = {
    key: "budget",
    value: "1",
    confidence: "inferred",
    sourceRef: "msg-2",
    recordedAt: "2026-08-10T00:00:00.000Z"
  };
  const service: ProposedFact = {
    ...budget,
    key: "service",
    value: "cut",
    confidence: "confirmed"
  };

  it("keeps the strong write and counts the refusal", async () => {
    const harness = ports({
      async hydrate() {
        return {
          facts: [
            {
              key: "budget",
              value: "5000",
              confidence: "confirmed",
              sourceRef: "msg-1",
              recordedAt: "2026-08-01T00:00:00.000Z",
              validUntil: null
            }
          ]
        };
      },
      async decide() {
        return decision({
          memoryWrites: [
            {
              key: "budget",
              value: "1",
              confidence: "inferred",
              sourceRef: "msg-2",
              recordedAt: "2026-08-10T00:00:00.000Z"
            },
            {
              key: "service",
              value: "cut",
              confidence: "confirmed",
              sourceRef: "msg-2",
              recordedAt: "2026-08-10T00:00:00.000Z"
            }
          ]
        });
      }
    });
    const record = await runTurn(event, harness.ports);
    expect(record.acceptedMemoryWrites).toBe(1);
    expect(record.refusedMemoryWrites).toBe(1);
  });

  it("files only what the policy accepted", async () => {
    // The refused write must not reach storage by another route: the policy is
    // the only thing standing between a guess and the customer record.
    const harness = ports({
      async hydrate() {
        return {
          facts: [
            {
              key: "budget",
              value: "5000",
              confidence: "confirmed",
              sourceRef: "msg-1",
              recordedAt: "2026-08-09T00:00:00.000Z"
            }
          ]
        };
      },
      async decide() {
        return decision({ memoryWrites: [budget, service] });
      }
    });
    await runTurn(event, harness.ports);
    expect(harness.filed.map((fact) => fact.key)).toEqual(["service"]);
  });

  it("files nothing when the turn proposed nothing", async () => {
    const harness = ports();
    await runTurn(event, harness.ports);
    expect(harness.calls).not.toContain("persistFacts");
  });

  it("files before committing", async () => {
    // A crash between the two re-runs the turn and re-files the same facts.
    // The other order leaves a record claiming a fact that exists nowhere.
    const harness = ports({
      async decide() {
        return decision({ memoryWrites: [service] });
      }
    });
    await runTurn(event, harness.ports);
    expect(harness.calls.indexOf("persistFacts")).toBeLessThan(harness.calls.indexOf("commit"));
  });

  it("says so on the record when a fact could not be filed", async () => {
    const harness = ports({
      async decide() {
        return decision({ memoryWrites: [service] });
      },
      async persistFacts() {
        return 0;
      }
    });
    const record = await runTurn(event, harness.ports);
    // Still sent: the reply is what the customer is waiting for. But a turn
    // reporting memory it does not have is the discrepancy an operator needs.
    expect(record.outcome).toBe("sent");
    expect(record.reasonCodes).toContain("memory_write_failed");
  });

  it("says so on a refused turn too", async () => {
    const harness = ports({
      async compose() {
        return reply({ text: "Only 99 TL!", citedRefs: [] });
      },
      async decide() {
        return decision({ memoryWrites: [service] });
      },
      async persistFacts() {
        return 0;
      }
    });
    const record = await runTurn(event, harness.ports);
    expect(record.outcome).not.toBe("sent");
    expect(record.reasonCodes).toContain("memory_write_failed");
  });

  it("stays quiet when every accepted fact was filed", async () => {
    const harness = ports({
      async decide() {
        return decision({ memoryWrites: [service] });
      }
    });
    const record = await runTurn(event, harness.ports);
    expect(record.reasonCodes).not.toContain("memory_write_failed");
  });
});

describe("decision priority", () => {
  it("ranks safety above everything and learning below everything", () => {
    expect(outranks("p0_safety_policy", "p1_explicit_request")).toBe(true);
    expect(outranks("p5_learning", "p4_improve_qualification")).toBe(false);
  });

  it("picks the most urgent candidate", () => {
    const chosen = highestPriority([
      decision({ priority: "p3_move_to_outcome", type: "qualify" }),
      decision({ priority: "p0_safety_policy", type: "handoff" }),
      decision({ priority: "p1_explicit_request" })
    ]);
    expect(chosen?.type).toBe("handoff");
  });

  it("keeps the earlier candidate on a tie", () => {
    const chosen = highestPriority([
      decision({ priority: "p1_explicit_request", type: "answer" }),
      decision({ priority: "p1_explicit_request", type: "clarify" })
    ]);
    expect(chosen?.type).toBe("answer");
  });

  it("orders every declared priority strictly", () => {
    for (let index = 1; index < DECISION_PRIORITIES.length; index += 1) {
      const higher = DECISION_PRIORITIES[index - 1]!;
      const lower = DECISION_PRIORITIES[index]!;
      expect(`${higher}>${lower}:${outranks(higher, lower)}`).toBe(`${higher}>${lower}:true`);
    }
  });

  it("returns nothing when there is nothing to choose", () => {
    expect(highestPriority([])).toBeUndefined();
  });
});
