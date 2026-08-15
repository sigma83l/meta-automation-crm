import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  STOP_REASONS,
  defaultCancelCondition,
  defaultObjective,
  evaluateEligibility,
  type FollowUpContext,
  type FollowUpPlan
} from "@/src/modules/crm/followup-policy";

const plan = (over: Partial<FollowUpPlan> = {}): FollowUpPlan => ({
  stopReason: "price_sent",
  objective: "diagnose whether the obstacle is affordability or value",
  cancelCondition: "customer declines explicitly",
  messageVersion: "v1",
  attempts: 0,
  ...over
});

const context = (over: Partial<FollowUpContext> = {}): FollowUpContext => ({
  customerRespondedSince: false,
  optedOut: false,
  cancelConditionMet: false,
  humanOwns: false,
  canSend: true,
  ...over
});

describe("a follow-up is not a timer", () => {
  it("sends when something is genuinely outstanding", () => {
    expect(evaluateEligibility(plan(), context())).toEqual({ eligible: true });
  });

  it("refuses a plan with no objective", () => {
    // Without one there is nothing to say beyond "just checking in", which
    // carries no information and invites no reply.
    expect(evaluateEligibility(plan({ objective: "  " }), context())).toMatchObject({
      eligible: false,
      terminal: true
    });
  });

  it("refuses a plan with no cancel condition", () => {
    expect(evaluateEligibility(plan({ cancelCondition: "" }), context())).toMatchObject({
      eligible: false,
      terminal: true
    });
  });

  it("stops once the customer has replied", () => {
    // Whatever this was chasing is no longer outstanding.
    expect(evaluateEligibility(plan(), context({ customerRespondedSince: true }))).toMatchObject({
      eligible: false,
      terminal: true
    });
  });

  it("stops when the cancel condition has been met", () => {
    expect(evaluateEligibility(plan(), context({ cancelConditionMet: true }))).toMatchObject({
      eligible: false,
      terminal: true
    });
  });

  it("stops permanently for an opt-out", () => {
    expect(evaluateEligibility(plan(), context({ optedOut: true }))).toMatchObject({
      eligible: false,
      terminal: true
    });
  });
});

describe("eligibility distinguishes a pause from an ending", () => {
  it("treats a send block as temporary, not terminal", () => {
    // The reason will pass; discarding the follow-up would lose the objective.
    expect(evaluateEligibility(plan(), context({ canSend: false }))).toMatchObject({
      eligible: false,
      terminal: false
    });
  });

  it("holds while a human owns the conversation", () => {
    expect(evaluateEligibility(plan(), context({ humanOwns: true }))).toMatchObject({
      eligible: false,
      terminal: false
    });
  });

  it("still chases a promise a human made and did not keep", () => {
    expect(
      evaluateEligibility(
        plan({ stopReason: "human_promised_response" }),
        context({ humanOwns: true })
      )
    ).toEqual({ eligible: true });
  });
});

describe("attempts are bounded", () => {
  it("stops at the budget for the reason", () => {
    expect(
      evaluateEligibility(plan({ stopReason: "price_sent", attempts: 2 }), context())
    ).toMatchObject({ eligible: false, reason: "attempt budget exhausted", terminal: true });
  });

  it("chases a promised human reply only once", () => {
    // Chasing on a person's behalf repeatedly turns a service failure into an
    // annoyance.
    expect(MAX_ATTEMPTS.human_promised_response).toBe(1);
    expect(
      evaluateEligibility(
        plan({ stopReason: "human_promised_response", attempts: 1 }),
        context({ humanOwns: true })
      )
    ).toMatchObject({ eligible: false, terminal: true });
  });

  it("gives every reason a finite budget", () => {
    for (const reason of STOP_REASONS) {
      expect(`${reason}:${MAX_ATTEMPTS[reason] > 0 && MAX_ATTEMPTS[reason] <= 3}`).toBe(
        `${reason}:true`
      );
    }
  });
});

describe("defaults", () => {
  it("gives every reason a specific objective and cancel condition", () => {
    for (const reason of STOP_REASONS) {
      expect(`${reason}:${defaultObjective(reason).length > 0}`).toBe(`${reason}:true`);
      expect(`${reason}:${defaultCancelCondition(reason).length > 0}`).toBe(`${reason}:true`);
    }
  });

  it("produces a plan that passes its own eligibility check", () => {
    for (const reason of STOP_REASONS) {
      const built = plan({
        stopReason: reason,
        objective: defaultObjective(reason),
        cancelCondition: defaultCancelCondition(reason)
      });
      expect(`${reason}:${evaluateEligibility(built, context()).eligible}`).toBe(`${reason}:true`);
    }
  });
});
