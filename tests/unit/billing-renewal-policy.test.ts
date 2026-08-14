import { describe, expect, it } from "vitest";
import {
  BILLING_MAX_CHARGE_ATTEMPTS,
  buildDueSubscriptionFilter,
  countConsecutiveFailures,
  hasExhaustedChargeAttempts,
  isTrialGrantable,
  trialEndAfterTransition
} from "@/src/modules/billing/renewal-policy";

const NOW = "2026-08-14T10:00:00.000Z";

describe("due-subscription selection", () => {
  const filter = buildDueSubscriptionFilter(NOW);

  it("matches a trialing subscription on its trial end date only", () => {
    expect(filter).toContain(`and(status.eq.trialing,trial_ends_at.lte.${NOW})`);
    // The defect: trialing was also matched on current_period_ends_at, and
    // every other status was matched on trial_ends_at.
    expect(filter).not.toContain(`and(status.eq.trialing,current_period_ends_at.lte.${NOW})`);
  });

  it("matches active and past_due on the period end date only", () => {
    expect(filter).toContain(`and(status.eq.active,current_period_ends_at.lte.${NOW})`);
    expect(filter).toContain(`and(status.eq.past_due,current_period_ends_at.lte.${NOW})`);
  });

  it("never lets trial_ends_at make a converted subscription due", () => {
    // This is the whole of the re-charge loop, expressed as a property: no
    // clause may pair a non-trialing status with the trial date.
    for (const status of ["active", "past_due", "canceled", "incomplete"]) {
      expect(filter).not.toContain(`and(status.eq.${status},trial_ends_at`);
    }
  });

  it("does not select cancelled or incomplete subscriptions at all", () => {
    expect(filter).not.toContain("status.eq.canceled");
    expect(filter).not.toContain("status.eq.incomplete");
  });
});

describe("consecutive charge failures", () => {
  // Attempts are newest-first, matching the query's descending order.
  it("counts nothing for a subscription that has never failed", () => {
    expect(countConsecutiveFailures([{ status: "succeeded" }, { status: "succeeded" }])).toBe(0);
  });

  it("stops counting at the most recent success", () => {
    expect(
      countConsecutiveFailures([
        { status: "declined" },
        { status: "declined" },
        { status: "succeeded" },
        { status: "declined" },
        { status: "declined" },
        { status: "declined" }
      ])
    ).toBe(2);
  });

  it("treats an ambiguous outcome as a failure", () => {
    expect(countConsecutiveFailures([{ status: "charge_unknown" }, { status: "declined" }])).toBe(
      2
    );
  });

  it("ignores unresolved attempts without ending the run", () => {
    // A pending row (e.g. skipped by a blocked live gate) is not evidence of
    // failure, and must not mask an older failure either.
    expect(countConsecutiveFailures([{ status: "pending" }, { status: "declined" }])).toBe(1);
  });

  it("does not cancel a long-lived customer who always pays", () => {
    // The defect: lifetime attempt count crossed the cap at the sixth renewal
    // and cancelled a perfectly healthy subscription before charging it.
    const tenSuccessfulRenewals = Array.from({ length: 10 }, () => ({ status: "succeeded" }));
    expect(hasExhaustedChargeAttempts(countConsecutiveFailures(tenSuccessfulRenewals))).toBe(false);
  });

  it("does not cancel when failures are interrupted by a success", () => {
    const history = [
      { status: "declined" },
      { status: "declined" },
      { status: "succeeded" },
      ...Array.from({ length: 8 }, () => ({ status: "declined" }))
    ];
    expect(hasExhaustedChargeAttempts(countConsecutiveFailures(history))).toBe(false);
  });

  it("cancels only after the cap of consecutive failures is reached", () => {
    const failures = (n: number) => Array.from({ length: n }, () => ({ status: "declined" }));
    expect(
      hasExhaustedChargeAttempts(
        countConsecutiveFailures(failures(BILLING_MAX_CHARGE_ATTEMPTS - 1))
      )
    ).toBe(false);
    expect(
      hasExhaustedChargeAttempts(countConsecutiveFailures(failures(BILLING_MAX_CHARGE_ATTEMPTS)))
    ).toBe(true);
  });
});

describe("trial end after a transition", () => {
  it("clears the trial end once a charge succeeds", () => {
    // Preserving the past trial end is exactly what kept a converted
    // subscription due on every subsequent tick.
    expect(trialEndAfterTransition(true, "2026-08-14T09:00:00.000Z")).toBeNull();
  });

  it("preserves the trial end when the charge did not succeed", () => {
    expect(trialEndAfterTransition(false, "2026-08-20T09:00:00.000Z")).toBe(
      "2026-08-20T09:00:00.000Z"
    );
  });

  it("stays null when there was no trial", () => {
    expect(trialEndAfterTransition(false, null)).toBeNull();
  });
});

describe("trial eligibility", () => {
  it("grants a trial to a new card on a workspace that has never trialed", () => {
    expect(isTrialGrantable(true, null)).toBe(true);
  });

  it("refuses a card fingerprint already seen elsewhere", () => {
    expect(isTrialGrantable(false, null)).toBe(false);
  });

  it("refuses a workspace that has already consumed its trial, even with a fresh card", () => {
    // The defect: eligibility keyed only on the fingerprint, so a canceled
    // workspace could cancel, register a different card, and receive a fresh
    // 7-day window — indefinitely.
    expect(isTrialGrantable(true, "2026-08-01T00:00:00.000Z")).toBe(false);
  });

  it("refuses when both gates fail", () => {
    expect(isTrialGrantable(false, "2026-08-01T00:00:00.000Z")).toBe(false);
  });
});
