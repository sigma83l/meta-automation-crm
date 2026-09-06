import { describe, expect, it } from "vitest";
import {
  ACTIVATION_FUNNEL,
  ANALYTICS_EVENTS,
  EVENT_GROUPS,
  funnelDepth,
  groupForEvent,
  isAnalyticsEvent,
  type AnalyticsEventName
} from "@/src/modules/analytics/taxonomy";

describe("the vocabulary is closed", () => {
  it("recognises a name from the taxonomy", () => {
    expect(isAnalyticsEvent("trial.started")).toBe(true);
  });

  it("refuses a plausible near-miss", () => {
    // An open vocabulary drifts within a fortnight — trial.started,
    // trial_started and trialStart all coexist and no funnel spans them.
    expect(isAnalyticsEvent("trial_started")).toBe(false);
    expect(isAnalyticsEvent("trialStarted")).toBe(false);
  });

  it("has no duplicate names across groups", () => {
    // A name in two groups would be counted twice by any group-level report.
    expect(new Set(ANALYTICS_EVENTS).size).toBe(ANALYTICS_EVENTS.length);
  });

  it("puts every event in exactly one group", () => {
    for (const name of ANALYTICS_EVENTS) {
      expect(`${name}:${EVENT_GROUPS.includes(groupForEvent(name))}`).toBe(`${name}:true`);
    }
  });

  it("refuses to group a name it does not know", () => {
    expect(() => groupForEvent("something.invented" as AnalyticsEventName)).toThrow(/Unknown/);
  });

  it("carries the pack's billing and reliability events", () => {
    for (const name of [
      "trial.capped",
      "entitlement.changed",
      "usage.threshold_crossed",
      "webhook.failed",
      "ai.validation_failed",
      "send.failed"
    ] as const) {
      expect(`${name}:${isAnalyticsEvent(name)}`).toBe(`${name}:true`);
    }
  });
});

describe("the activation funnel has one definition", () => {
  it("is made of real events, in order", () => {
    for (const step of ACTIVATION_FUNNEL) {
      expect(`${step}:${isAnalyticsEvent(step)}`).toBe(`${step}:true`);
    }
    expect(ACTIVATION_FUNNEL[0]).toBe("workspace.provisioned");
  });

  it("counts nothing for a workspace that has done nothing", () => {
    expect(funnelDepth([])).toBe(0);
  });

  it("counts the prefix reached", () => {
    expect(funnelDepth(["workspace.provisioned", "onboarding.stage_completed"])).toBe(2);
  });

  it("counts the whole funnel when every step is present", () => {
    expect(funnelDepth([...ACTIVATION_FUNNEL])).toBe(ACTIVATION_FUNNEL.length);
  });

  it("stops at a gap rather than counting past it", () => {
    // A workspace that recorded step 4 without step 3 has not completed step 4
    // in any sense a funnel should report, and counting it hides the gap worth
    // investigating.
    expect(
      funnelDepth(["workspace.provisioned", "channel.connected", "first_meaningful_received"])
    ).toBe(1);
  });

  it("ignores events outside the funnel", () => {
    expect(
      funnelDepth(["workspace.provisioned", "send.failed", "onboarding.stage_completed"])
    ).toBe(2);
  });
});
