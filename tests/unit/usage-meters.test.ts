import { describe, expect, it } from "vitest";
import {
  APPROACHING_THRESHOLD,
  USAGE_METERS,
  aiReplyCounts,
  authorizeUsage,
  automationActionCounts,
  capStateFor,
  limitsForEntitlements,
  macIdempotencyKey,
  trialPauseFor,
  type MeterLimits
} from "@/src/modules/billing/usage-meters";
import {
  CATALOGUE_V1,
  entitlementsForPlan
} from "@/src/modules/billing/providers/paddle/catalogue";

const trialLimits: MeterLimits = limitsForEntitlements(entitlementsForPlan(CATALOGUE_V1, "trial"));

describe("what counts as an AI reply", () => {
  it("counts a reply the customer received", () => {
    expect(aiReplyCounts("sent", true)).toBe(true);
  });

  it("counts an ambiguous send", () => {
    // The provider accepted it and we cannot prove it did not arrive. Free
    // would make the ambiguous case the cheapest kind, which is backwards.
    expect(aiReplyCounts("sent_unknown", true)).toBe(true);
  });

  it("does not count a failed send", () => {
    // Charging for a reply the customer never received also removes our own
    // incentive to fix delivery.
    expect(aiReplyCounts("failed", true)).toBe(false);
  });

  it("does not count a reply the validator rejected", () => {
    expect(aiReplyCounts("rejected_by_validator", true)).toBe(false);
  });

  it("does not count internal AI at all", () => {
    // Classification and routing are telemetry. Metering them would mean a
    // refactor changes somebody's bill.
    for (const outcome of ["sent", "sent_unknown", "failed"] as const) {
      expect(`${outcome}:${aiReplyCounts(outcome, false)}`).toBe(`${outcome}:false`);
    }
  });
});

describe("what counts as an automation action", () => {
  it("counts an executed action", () => {
    expect(automationActionCounts(true, false)).toBe(true);
  });

  it("does not count a technical retry", () => {
    // The workspace asked for one thing to happen; our infrastructure failing
    // at it first time is not billable.
    expect(automationActionCounts(true, true)).toBe(false);
  });

  it("does not count an action that never ran", () => {
    expect(automationActionCounts(false, false)).toBe(false);
  });
});

describe("MAC is unique per contact per cycle", () => {
  it("collapses repeat interactions onto one key", () => {
    expect(macIdempotencyKey("cyc_1", "cus_1")).toBe(macIdempotencyKey("cyc_1", "cus_1"));
  });

  it("counts the same contact again in a new cycle", () => {
    expect(macIdempotencyKey("cyc_2", "cus_1")).not.toBe(macIdempotencyKey("cyc_1", "cus_1"));
  });

  it("keeps different contacts apart", () => {
    expect(macIdempotencyKey("cyc_1", "cus_2")).not.toBe(macIdempotencyKey("cyc_1", "cus_1"));
  });
});

describe("cap states", () => {
  it("is fine well below the limit", () => {
    expect(capStateFor(10, 100)).toBe("ok");
  });

  it("warns at the threshold", () => {
    expect(capStateFor(100 * APPROACHING_THRESHOLD, 100)).toBe("approaching");
  });

  it("is reached at the limit, not past it", () => {
    expect(capStateFor(100, 100)).toBe("reached");
  });

  it("treats a zero limit as already reached", () => {
    // A plan with no allowance of a meter must not read as unlimited.
    expect(capStateFor(0, 0)).toBe("reached");
  });
});

describe("quota authorisation happens before the work", () => {
  it("permits a send inside the allowance", () => {
    expect(authorizeUsage("ai_reply", { ai_reply: 10 }, trialLimits)).toEqual({
      allowed: true,
      state: "ok"
    });
  });

  it("reports the approaching state on the way up", () => {
    expect(authorizeUsage("ai_reply", { ai_reply: 130 }, trialLimits)).toMatchObject({
      allowed: true,
      state: "approaching"
    });
  });

  it("refuses the unit that would cross the limit", () => {
    // Checked before, not after: a cap discovered afterwards has already cost
    // the customer a message they cannot unsend.
    expect(authorizeUsage("ai_reply", { ai_reply: 150 }, trialLimits)).toEqual({
      allowed: false,
      meter: "ai_reply",
      used: 150,
      limit: 150
    });
  });

  it("accounts for quantity greater than one", () => {
    expect(
      authorizeUsage("media_bytes", { media_bytes: 0 }, trialLimits, 200 * 1024 * 1024)
    ).toMatchObject({ allowed: false });
  });

  it("treats an unmeasured meter as zero rather than unlimited", () => {
    expect(authorizeUsage("mac", {}, trialLimits)).toMatchObject({ allowed: true });
    expect(authorizeUsage("mac", {}, { ...trialLimits, mac: 0 })).toMatchObject({ allowed: false });
  });

  it("has a limit for every meter", () => {
    for (const meter of USAGE_METERS) {
      expect(`${meter}:${typeof trialLimits[meter]}`).toBe(`${meter}:number`);
    }
  });
});

describe("trial limits come from the pack", () => {
  it("carries the V1 numbers", () => {
    expect(trialLimits).toMatchObject({
      mac: 100,
      ai_reply: 150,
      automation_action: 300,
      seat: 2,
      media_bytes: 100 * 1024 * 1024
    });
  });
});

describe("exhausting a trial quota pauses AI, not the inbox", () => {
  it("does nothing while quota remains", () => {
    expect(trialPauseFor({ ai_reply: 10 }, trialLimits)).toEqual({
      aiPaused: false,
      manualAllowed: true,
      reason: null
    });
  });

  it("pauses AI when replies run out but leaves humans working", () => {
    // Cutting a workspace off from its own inbox would strand conversations
    // with real customers in them, who never agreed to our billing model.
    expect(trialPauseFor({ ai_reply: 150 }, trialLimits)).toEqual({
      aiPaused: true,
      manualAllowed: true,
      reason: "ai_reply_quota_reached"
    });
  });

  it("pauses on the automation quota too", () => {
    expect(trialPauseFor({ automation_action: 300 }, trialLimits)).toMatchObject({
      aiPaused: true,
      manualAllowed: true,
      reason: "automation_quota_reached"
    });
  });

  it("never withdraws manual working, whatever is exhausted", () => {
    expect(
      trialPauseFor({ ai_reply: 999, automation_action: 999, mac: 999 }, trialLimits).manualAllowed
    ).toBe(true);
  });
});
