import { describe, expect, it } from "vitest";
import {
  DELETION_DAY,
  INGESTION_WINDOW_HOURS,
  READ_ONLY_DAYS,
  TRIAL_DURATION_DAYS,
  TRIAL_PHASES,
  authorizeTrialDeletion,
  trialCapabilitiesFor,
  trialPhaseAt,
  trialScheduleFrom
} from "@/src/modules/billing/trial-lifecycle";

const ENDS = new Date("2026-08-08T00:00:00.000Z");
const at = (iso: string) => trialPhaseAt(ENDS, new Date(iso));

describe("the trial winds down in stages", () => {
  it("is active before the end date", () => {
    expect(at("2026-08-07T23:59:00.000Z")).toBe("active");
  });

  it("opens the ingestion window the moment the trial ends", () => {
    expect(at("2026-08-08T00:00:00.000Z")).toBe("ingestion_window");
  });

  it("keeps ingesting for the full 72 hours", () => {
    expect(at("2026-08-10T23:59:00.000Z")).toBe("ingestion_window");
  });

  it("suspends integrations once the window closes", () => {
    expect(at("2026-08-11T00:01:00.000Z")).toBe("read_only");
  });

  it("stays readable for a fortnight", () => {
    expect(at("2026-08-21T00:00:00.000Z")).toBe("read_only");
  });

  it("schedules cleanup after that", () => {
    expect(at("2026-08-23T00:00:00.000Z")).toBe("pending_deletion");
  });

  it("carries the pack's durations", () => {
    expect([TRIAL_DURATION_DAYS, INGESTION_WINDOW_HOURS, READ_ONLY_DAYS, DELETION_DAY]).toEqual([
      7, 72, 14, 30
    ]);
  });
});

describe("ingestion outlives sending", () => {
  it("stops outbound but keeps accepting inbound", () => {
    // A trial ending does not tell the customer's customers to stop messaging
    // them; dropping those on the hour would lose real conversations.
    const capabilities = trialCapabilitiesFor("ingestion_window");
    expect(capabilities.outboundSend).toBe(false);
    expect(capabilities.inboundIngestion).toBe(true);
  });

  it("closes ingestion only at the read-only phase", () => {
    expect(trialCapabilitiesFor("read_only").inboundIngestion).toBe(false);
  });

  it("never lets sending outlive ingestion in any phase", () => {
    // The reverse ordering would mean replying into a workspace that can no
    // longer see what it is replying to.
    for (const phase of TRIAL_PHASES) {
      const capabilities = trialCapabilitiesFor(phase);
      const consistent = !capabilities.outboundSend || capabilities.inboundIngestion;
      expect(`${phase}:${consistent}`).toBe(`${phase}:true`);
    }
  });
});

describe("the data outlives the trial", () => {
  it("keeps read and export available in every phase", () => {
    for (const phase of TRIAL_PHASES) {
      const capabilities = trialCapabilitiesFor(phase);
      expect(`${phase}:${capabilities.readAccess && capabilities.export}`).toBe(`${phase}:true`);
    }
  });

  it("allows an upgrade even once deletion is scheduled", () => {
    // Somebody returning on day 25 to pay should get their workspace back, not
    // a condolence message.
    expect(trialCapabilitiesFor("pending_deletion").upgrade).toBe(true);
  });
});

describe("the schedule", () => {
  const schedule = trialScheduleFrom(new Date("2026-08-01T00:00:00.000Z"));

  it("ends the trial seven days in", () => {
    expect(schedule.trialEndsAt).toBe("2026-08-08T00:00:00.000Z");
  });

  it("closes ingestion 72 hours after that", () => {
    expect(schedule.ingestionClosesAt).toBe("2026-08-11T00:00:00.000Z");
  });

  it("keeps the data readable for fourteen days past the end", () => {
    expect(schedule.readOnlyUntil).toBe("2026-08-22T00:00:00.000Z");
  });

  it("schedules deletion on day 30 of the workspace, not of the wind-down", () => {
    expect(schedule.deletionScheduledFor).toBe("2026-08-31T00:00:00.000Z");
  });

  it("orders every boundary correctly", () => {
    const stamps = [
      schedule.trialEndsAt,
      schedule.ingestionClosesAt,
      schedule.readOnlyUntil,
      schedule.deletionScheduledFor
    ].map((iso) => Date.parse(iso));
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
  });
});

describe("deletion fails closed", () => {
  const base = {
    deletionScheduledFor: "2026-08-31T00:00:00.000Z",
    hasSubscription: false,
    retentionPolicyApplies: false,
    legalHold: false,
    now: new Date("2026-09-01T00:00:00.000Z")
  };

  it("proceeds when the schedule has passed and nothing holds it", () => {
    expect(authorizeTrialDeletion(base)).toEqual({ delete: true });
  });

  it("refuses before the scheduled date", () => {
    expect(
      authorizeTrialDeletion({ ...base, now: new Date("2026-08-20T00:00:00.000Z") })
    ).toMatchObject({ delete: false });
  });

  it("refuses once a subscription exists", () => {
    // They paid. Whatever the schedule said, it is out of date.
    expect(authorizeTrialDeletion({ ...base, hasSubscription: true })).toMatchObject({
      delete: false,
      reason: "workspace has a subscription"
    });
  });

  it("refuses under a legal hold", () => {
    expect(authorizeTrialDeletion({ ...base, legalHold: true })).toMatchObject({
      delete: false,
      reason: "legal hold"
    });
  });

  it("refuses where a retention policy applies", () => {
    expect(authorizeTrialDeletion({ ...base, retentionPolicyApplies: true })).toMatchObject({
      delete: false
    });
  });

  it("refuses on an unreadable schedule rather than deleting now", () => {
    // Deletion is the one thing here that cannot be walked back, so an unknown
    // answer is a reason to stop.
    expect(authorizeTrialDeletion({ ...base, deletionScheduledFor: "" })).toMatchObject({
      delete: false
    });
    expect(authorizeTrialDeletion({ ...base, deletionScheduledFor: "not a date" })).toMatchObject({
      delete: false
    });
  });
});
