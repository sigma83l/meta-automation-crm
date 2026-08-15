import { describe, expect, it } from "vitest";
import {
  HANDOFF_TRIGGERS,
  SLA_MINUTES,
  buildHandoffPacket,
  isActionable,
  isSlaBreached,
  type HandoffInput
} from "@/src/modules/crm/handoff-packet";

const input = (over: Partial<HandoffInput> = {}): HandoffInput => ({
  trigger: "customer_requested_human",
  summary: "Wants a same-week appointment for a service we do not list.",
  intent: "book_appointment",
  mentalState: "impatient after two unanswered questions",
  knownFacts: [{ key: "city", value: "Izmir", sourceRef: "msg_9012" }],
  qualificationScore: 62,
  scoreReasons: ["stated timing", "in service area"],
  objections: ["price above expectation"],
  actionsTaken: ["sent price list", "offered two slots"],
  suggestedNextAction: "confirm whether the unlisted service can be scheduled",
  policyFlags: [],
  ownerId: "user_1",
  lifecycleStage: "qualified",
  leadStatus: "awaiting_customer",
  ...over
});

describe("the packet carries everything the thread would", () => {
  it("keeps every section the pack requires", () => {
    const packet = buildHandoffPacket(input());
    expect(Object.keys(packet)).toEqual(
      expect.arrayContaining([
        "summary",
        "intent",
        "mentalState",
        "knownFacts",
        "score",
        "objections",
        "actionsTaken",
        "suggestedNextAction",
        "policyFlags",
        "owner"
      ])
    );
  });

  it("carries lifecycle and lead status without merging them", () => {
    const packet = buildHandoffPacket(input());
    expect(packet.lifecycleStage).toBe("qualified");
    expect(packet.leadStatus).toBe("awaiting_customer");
  });

  it("pairs the score with the reasons behind it", () => {
    const packet = buildHandoffPacket(input());
    expect(packet.score).toEqual({
      value: 62,
      reasons: ["stated timing", "in service area"]
    });
  });
});

describe("missing information is named, not hidden", () => {
  it("marks an empty summary as unknown rather than blank", () => {
    // A blank field reads as "nothing to report", which is a different claim.
    const packet = buildHandoffPacket(input({ summary: "   " }));
    expect(packet.unknownSections).toContain("summary");
    expect(packet.summary).toBe("not established");
  });

  it("treats a score with no reasons as unknown", () => {
    // The number looks just as confident either way; the human cannot check it.
    const packet = buildHandoffPacket(input({ scoreReasons: [] }));
    expect(packet.unknownSections).toContain("score");
  });

  it("distinguishes no objections from unrecorded objections", () => {
    expect(buildHandoffPacket(input({ objections: [] })).unknownSections).toContain("objections");
    expect(buildHandoffPacket(input()).unknownSections).not.toContain("objections");
  });

  it("drops a fact that cannot be traced", () => {
    // An untraceable fact costs the human more to verify than to ask again.
    const packet = buildHandoffPacket(
      input({
        knownFacts: [
          { key: "city", value: "Izmir", sourceRef: "msg_9012" },
          { key: "budget", value: "8000 TL", sourceRef: "" }
        ]
      })
    );
    expect(packet.knownFacts.map((fact) => fact.key)).toEqual(["city"]);
  });
});

describe("actionability", () => {
  it("accepts a packet with a subject and a next step", () => {
    expect(isActionable(buildHandoffPacket(input()))).toBe(true);
  });

  it("still accepts one with no objections or policy flags", () => {
    // Most conversations have neither; requiring them would fail every packet.
    expect(isActionable(buildHandoffPacket(input({ objections: [], policyFlags: [] })))).toBe(true);
  });

  it("refuses one with no suggested next action", () => {
    expect(isActionable(buildHandoffPacket(input({ suggestedNextAction: "" })))).toBe(false);
  });
});

describe("owner and SLA", () => {
  it("gives every trigger an SLA", () => {
    for (const trigger of HANDOFF_TRIGGERS) {
      expect(`${trigger}:${typeof SLA_MINUTES[trigger]}`).toBe(`${trigger}:number`);
    }
  });

  it("puts the shortest clock on a customer who asked for a person", () => {
    // They are already waiting, and they asked explicitly.
    expect(SLA_MINUTES.customer_requested_human).toBeLessThanOrEqual(
      SLA_MINUTES.confidence_below_threshold
    );
  });

  it("flags an unassigned handoff", () => {
    expect(buildHandoffPacket(input({ ownerId: null })).unknownSections).toContain("owner");
  });

  it("breaches once the clock runs out", () => {
    const packet = buildHandoffPacket(input());
    const raised = new Date("2026-08-15T10:00:00Z");
    expect(isSlaBreached(packet, raised, new Date("2026-08-15T10:10:00Z"))).toBe(false);
    expect(isSlaBreached(packet, raised, new Date("2026-08-15T10:20:00Z"))).toBe(true);
  });

  it("never breaches a takeover the owner started themselves", () => {
    const packet = buildHandoffPacket(input({ trigger: "owner_takeover" }));
    expect(
      isSlaBreached(packet, new Date("2026-08-15T10:00:00Z"), new Date("2026-08-16T10:00:00Z"))
    ).toBe(false);
  });
});
