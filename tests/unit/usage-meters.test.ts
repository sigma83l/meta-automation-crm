import { describe, expect, it } from "vitest";
import {
  APPROACHING_THRESHOLD,
  USAGE_METERS,
  aiReplyCounts,
  authorizeUsage,
  automationActionCounts,
  capStateFor,
  limitsForEntitlements,
  limitsForPlanRow,
  macIdempotencyKey,
  workUnitsFor,
  workUnitsIdempotencyKey,
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

  it("has a limit for every meter the retired catalogue knows about", () => {
    // Not every meter any more. The 2026-09-v2 catalogue meters work units and
    // connector units, which the Paddle catalogue file has nowhere to put -
    // those limits come from the `subscription_plans` row instead, and
    // `limitsForPlanRow` is what reads them.
    for (const meter of ["mac", "ai_reply", "automation_action", "seat", "media_bytes"] as const) {
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

describe("AI work units", () => {
  it("keeps the retired meters listed so historical rows stay readable", () => {
    // Nothing writes them any more. Dropping them from the union would make a
    // ledger row written under the old model unreadable by the code that has
    // to explain an old invoice.
    expect(USAGE_METERS).toContain("ai_reply");
    expect(USAGE_METERS).toContain("automation_action");
    expect(USAGE_METERS).toContain("ai_work_units");
  });

  it("prices a cheap lookup below a reasoned reply", () => {
    // The whole reason the meter changed. `ai_reply` charged these the same,
    // so a one-line read of approved hours subsidised a reasoned reply to a
    // complaint and neither price meant anything.
    const lookup = workUnitsFor({ role: "lookup", outcome: "sent" });
    const primary = workUnitsFor({ role: "primary", outcome: "sent" });
    const escalation = workUnitsFor({ role: "escalation", outcome: "sent" });
    expect(lookup).toBe(1);
    expect(primary).toBe(2);
    expect(escalation).toBe(5);
    expect(lookup).toBeLessThan(primary);
    expect(primary).toBeLessThan(escalation);
  });

  it("charges nothing when no model ran", () => {
    expect(workUnitsFor({ role: "deterministic", outcome: "sent" })).toBe(0);
  });

  it("charges nothing for a reply the customer never received", () => {
    // Tokens were spent either way, but billing for an undelivered reply is
    // indefensible and removes our own incentive to stop producing them. The
    // same rule `aiReplyCounts` applies, and the two must not disagree.
    for (const outcome of ["failed", "rejected_by_validator"] as const) {
      expect(`${outcome}:${workUnitsFor({ role: "escalation", outcome })}`).toBe(`${outcome}:0`);
    }
  });

  it("charges an ambiguous send, because it is not free to us either", () => {
    expect(workUnitsFor({ role: "primary", outcome: "sent_unknown" })).toBe(2);
  });

  it("prices a turn that drove a tool above one that did not", () => {
    expect(workUnitsFor({ role: "primary", outcome: "sent", toolExecuted: true })).toBe(3);
    expect(workUnitsFor({ role: "escalation", outcome: "sent", toolExecuted: true })).toBe(8);
  });

  it("keys one row per event, so a redelivered turn cannot bill twice", () => {
    expect(workUnitsIdempotencyKey("evt-1")).toBe(workUnitsIdempotencyKey("evt-1"));
    expect(workUnitsIdempotencyKey("evt-1")).not.toBe(workUnitsIdempotencyKey("evt-2"));
  });
});

describe("limits read from the plan catalogue row", () => {
  const growth = {
    mac: 2500,
    ai_work_units: 3000,
    automation_actions: 15000,
    connector_units: 5000,
    seats: 3,
    storage_mb: 10240
  };

  it("carries the 2026-09-v2 numbers across, converting storage to bytes", () => {
    const limits = limitsForPlanRow(growth);
    expect(limits.mac).toBe(2500);
    expect(limits.ai_work_units).toBe(3000);
    expect(limits.connector_units).toBe(5000);
    expect(limits.seat).toBe(3);
    expect(limits.media_bytes).toBe(10240 * 1024 * 1024);
  });

  it("leaves a fair-use column absent rather than calling it zero", () => {
    // Business and Agency record no workflow number. Reading null as 0 would
    // stop the very plans that were sold as unmetered.
    const limits = limitsForPlanRow({ ...growth, connector_units: null });
    expect(limits.connector_units).toBeUndefined();
    expect(authorizeUsage("connector_units", { connector_units: 999999 }, limits)).toEqual({
      allowed: true,
      state: "ok"
    });
  });

  it("still refuses a meter that has a limit and has reached it", () => {
    const limits = limitsForPlanRow(growth);
    const verdict = authorizeUsage("ai_work_units", { ai_work_units: 3000 }, limits);
    expect(verdict).toEqual({ allowed: false, meter: "ai_work_units", used: 3000, limit: 3000 });
  });
});
