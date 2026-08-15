import { describe, expect, it } from "vitest";
import {
  LEAD_STATUSES,
  LIFECYCLE_STAGES,
  authorizeLifecycleTransition,
  isForwardTransition,
  mayAsk,
  permittedQuestions,
  scoreFromEvidence,
  type LifecycleTransition,
  type QualificationDepth
} from "@/src/modules/crm/revenue-state";

const transition = (over: Partial<LifecycleTransition> = {}): LifecycleTransition => ({
  from: "new",
  to: "engaged",
  reasonCodes: ["replied_to_first_message"],
  actor: "system",
  ...over
});

describe("the three concepts stay separate", () => {
  it("shares no vocabulary between lifecycle and lead status", () => {
    // If a value appeared in both, code would eventually treat them as the same
    // field and the distinction would quietly collapse.
    const overlap = LIFECYCLE_STAGES.filter((stage) =>
      (LEAD_STATUSES as readonly string[]).includes(stage)
    );
    expect(overlap).toEqual([]);
  });

  it("exports nothing that maps one onto the other", async () => {
    // The separation is enforced by absence: any deriving function would be
    // inventing information.
    const exported = await import("@/src/modules/crm/revenue-state");
    const suspicious = Object.keys(exported).filter((name) =>
      /statusFrom|stageFrom|deriveStatus|deriveStage/i.test(name)
    );
    expect(suspicious).toEqual([]);
  });
});

describe("lifecycle transitions need a reason", () => {
  it("allows a forward move with reason and actor", () => {
    expect(authorizeLifecycleTransition(transition())).toEqual({ allowed: true });
  });

  it("refuses a move with no reason codes", () => {
    // A stage that advanced for no recorded cause cannot be explained to the
    // owner or corrected afterwards.
    expect(authorizeLifecycleTransition(transition({ reasonCodes: [] }))).toMatchObject({
      allowed: false,
      reason: "reason codes required"
    });
  });

  it("refuses a move with no actor", () => {
    expect(authorizeLifecycleTransition(transition({ actor: "" }))).toMatchObject({
      allowed: false
    });
  });

  it("refuses a move to the stage already held", () => {
    expect(
      authorizeLifecycleTransition(transition({ from: "engaged", to: "engaged" }))
    ).toMatchObject({ allowed: false, reason: "no change" });
  });

  it("allows skipping ahead, since a referral can arrive ready", () => {
    expect(authorizeLifecycleTransition(transition({ from: "new", to: "sales_ready" }))).toEqual({
      allowed: true
    });
  });

  it("allows moving backwards, because deals stall", () => {
    // Forward-only lifecycles fill up with contacts marked Customer who are
    // nothing of the kind.
    expect(
      authorizeLifecycleTransition(transition({ from: "opportunity", to: "engaged" }))
    ).toEqual({ allowed: true });
  });

  it("refuses retention for anyone who was never a customer", () => {
    expect(
      authorizeLifecycleTransition(transition({ from: "qualified", to: "retention" }))
    ).toMatchObject({ allowed: false });
    expect(authorizeLifecycleTransition(transition({ from: "customer", to: "retention" }))).toEqual(
      { allowed: true }
    );
  });

  it("reports direction without judging it", () => {
    expect(isForwardTransition("new", "qualified")).toBe(true);
    expect(isForwardTransition("customer", "engaged")).toBe(false);
  });
});

describe("qualification score", () => {
  it("is zero with no evidence at all", () => {
    // "We know nothing" and "we assessed them as average" are different claims
    // and only one is true.
    expect(scoreFromEvidence([])).toBe(0);
  });

  it("discounts an inference against a stated fact", () => {
    const inferred = scoreFromEvidence([
      { signal: "budget_fit", weight: 50, confidence: "inferred" }
    ]);
    const confirmed = scoreFromEvidence([
      { signal: "budget_fit", weight: 50, confidence: "confirmed" }
    ]);
    expect(inferred).toBeLessThan(confirmed);
  });

  it("treats a human verification as fully weighted", () => {
    expect(
      scoreFromEvidence([{ signal: "budget_fit", weight: 40, confidence: "human_verified" }])
    ).toBe(40);
  });

  it("lets negative evidence pull a score down", () => {
    expect(
      scoreFromEvidence([
        { signal: "budget_fit", weight: 60, confidence: "confirmed" },
        { signal: "out_of_area", weight: -30, confidence: "confirmed" }
      ])
    ).toBe(30);
  });

  it("stays inside nought to a hundred", () => {
    expect(
      scoreFromEvidence([
        { signal: "everything", weight: 100, confidence: "confirmed" },
        { signal: "more", weight: 100, confidence: "confirmed" }
      ])
    ).toBe(100);
    expect(
      scoreFromEvidence([{ signal: "terrible_fit", weight: -100, confidence: "confirmed" }])
    ).toBe(0);
  });
});

describe("what may be asked", () => {
  it("keeps a first contact to intent and one constraint", () => {
    expect(permittedQuestions("first_contact")).toEqual(["intent", "primary_constraint"]);
  });

  it("never asks a first-time enquirer about budget", () => {
    // Interrogating someone who just said hello is how a conversation ends
    // before it starts.
    expect(mayAsk("first_contact", "budget")).toBe(false);
    expect(mayAsk("high_value", "budget")).toBe(true);
  });

  it("asks only transaction-required slots once ready", () => {
    expect(permittedQuestions("ready")).toEqual(["transaction_required_slots"]);
  });

  it("defines a permitted set for every depth", () => {
    for (const depth of [
      "first_contact",
      "consideration",
      "ready",
      "high_value"
    ] as QualificationDepth[]) {
      expect(`${depth}:${permittedQuestions(depth).length > 0}`).toBe(`${depth}:true`);
    }
  });

  it("refuses a slot no depth permits", () => {
    // Never ask a question merely because the CRM has a field.
    for (const depth of [
      "first_contact",
      "consideration",
      "ready",
      "high_value"
    ] as QualificationDepth[]) {
      expect(`${depth}:${mayAsk(depth, "favourite_colour")}`).toBe(`${depth}:false`);
    }
  });
});
