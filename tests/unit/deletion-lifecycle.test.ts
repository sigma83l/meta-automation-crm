import { describe, expect, it } from "vitest";
import {
  DELETION_GRACE_HOURS,
  authorizeStageAdvance,
  isReversible,
  isTombstoneClean,
  requiresRepurgeAfterRestore,
  type DeletionRequest,
  type Tombstone
} from "@/src/modules/security/deletion-lifecycle";

const REQUESTED_AT = "2026-08-16T10:00:00.000Z";
const AFTER_GRACE = new Date("2026-08-19T11:00:00.000Z");

const request = (over: Partial<DeletionRequest> = {}): DeletionRequest => ({
  stage: "requested",
  requestedAt: REQUESTED_AT,
  purgeStartedAt: null,
  legalHold: false,
  retentionExceptions: [],
  ...over
});

const tombstone = (over: Partial<Tombstone> = {}): Tombstone => ({
  workspaceId: "ws_1",
  deletedAt: "2026-08-19T12:00:00.000Z",
  purgedCounts: { customers: 412, messages: 9_003 },
  storageObjectsPurged: 87,
  subprocessorsNotified: ["supabase", "meta"],
  requestReason: "owner_request",
  ...over
});

describe("deletion is a data instruction, not a billing outcome", () => {
  it("consults no subscription state anywhere", async () => {
    // Deleting a cancelled customer's data destroys the work of somebody who
    // may simply have paused; refusing a deletion because they still pay
    // ignores a legal instruction.
    const exported = await import("@/src/modules/security/deletion-lifecycle");
    const suspicious = Object.keys(exported).filter((name) =>
      /subscription|billing|plan|entitle/i.test(name)
    );
    expect(suspicious).toEqual([]);
  });
});

describe("the grace window", () => {
  it("holds a fresh request", () => {
    // Long enough for somebody who clicked by mistake, or whose account was
    // taken over, to notice.
    expect(authorizeStageAdvance(request(), new Date("2026-08-16T12:00:00.000Z"))).toMatchObject({
      allowed: false,
      reason: "grace window has not elapsed"
    });
  });

  it("releases once it has elapsed", () => {
    expect(authorizeStageAdvance(request(), AFTER_GRACE)).toEqual({
      allowed: true,
      next: "integrations_disabled"
    });
  });

  it("is 72 hours", () => {
    expect(DELETION_GRACE_HOURS).toBe(72);
  });

  it("refuses to advance on an unreadable timestamp", () => {
    expect(authorizeStageAdvance(request({ requestedAt: "whenever" }), AFTER_GRACE)).toMatchObject({
      allowed: false
    });
  });
});

describe("everything reversible happens first", () => {
  it("disables integrations before purging anything", () => {
    // A workspace still receiving webhooks mid-purge writes new rows behind the
    // deletion, and nobody will think to look for them afterwards.
    expect(authorizeStageAdvance(request(), AFTER_GRACE)).toMatchObject({
      next: "integrations_disabled"
    });
    expect(
      authorizeStageAdvance(request({ stage: "integrations_disabled" }), AFTER_GRACE)
    ).toMatchObject({ next: "purging" });
  });

  it("can still be called off before the purge", () => {
    expect(isReversible(request())).toBe(true);
    expect(isReversible(request({ stage: "integrations_disabled" }))).toBe(true);
  });

  it("cannot be called off once purging has started", () => {
    // Cancelling something that has already destroyed half its rows leaves a
    // workspace in a state nobody can describe.
    expect(isReversible(request({ stage: "purging" }))).toBe(false);
    expect(isReversible(request({ stage: "completed" }))).toBe(false);
  });
});

describe("holds and exceptions stop the machine", () => {
  it("stops at any stage under a legal hold", () => {
    for (const stage of ["requested", "integrations_disabled", "purging"] as const) {
      expect(
        `${stage}:${authorizeStageAdvance(request({ stage, legalHold: true }), AFTER_GRACE).allowed}`
      ).toBe(`${stage}:false`);
    }
  });

  it("checks retention exceptions immediately before the irreversible step", () => {
    // A legal obligation can arrive after somebody asks to be deleted, so the
    // check that matters is the last one before the purge.
    expect(
      authorizeStageAdvance(
        request({ stage: "integrations_disabled", retentionExceptions: ["tax_records"] }),
        AFTER_GRACE
      )
    ).toMatchObject({ allowed: false, reason: "retention exception applies" });
  });

  it("does not let a retention exception block the reversible stages", () => {
    // Stopping integrations is safe regardless, and doing it early limits what
    // still has to be purged later.
    expect(
      authorizeStageAdvance(request({ retentionExceptions: ["tax_records"] }), AFTER_GRACE)
    ).toMatchObject({ allowed: true });
  });

  it("refuses to advance a completed or held deletion", () => {
    expect(authorizeStageAdvance(request({ stage: "completed" }), AFTER_GRACE)).toMatchObject({
      allowed: false
    });
    expect(authorizeStageAdvance(request({ stage: "held" }), AFTER_GRACE)).toMatchObject({
      allowed: false
    });
  });
});

describe("the tombstone holds no personal data", () => {
  it("accepts counts and subprocessor names", () => {
    expect(isTombstoneClean(tombstone())).toBe(true);
  });

  it("rejects one carrying an email address", () => {
    // The tombstone outlives the data by design, so anything personal in it
    // outlives the deletion too.
    expect(
      isTombstoneClean(tombstone({ subprocessorsNotified: ["billing@customer.example"] }))
    ).toBe(false);
  });

  it("rejects one carrying a phone number", () => {
    expect(isTombstoneClean(tombstone({ workspaceId: "+90 532 111 22 33" }))).toBe(false);
  });

  it("rejects one carrying a provider message id", () => {
    // The field that catches somebody out is never called `email`.
    expect(isTombstoneClean(tombstone({ purgedCounts: { "wamid.HBgMOTA1MzIx": 1 } }))).toBe(false);
  });
});

describe("deletion survives a restore", () => {
  it("re-purges a workspace deleted after the backup was taken", () => {
    // The backup still contains everything; without the tombstone the restore
    // silently resurrects it.
    expect(
      requiresRepurgeAfterRestore("ws_1", [tombstone()], new Date("2026-08-01T00:00:00.000Z"))
    ).toBe(true);
  });

  it("leaves alone a workspace deleted before the backup", () => {
    // The backup was taken after the purge, so it never held the data.
    expect(
      requiresRepurgeAfterRestore("ws_1", [tombstone()], new Date("2026-09-01T00:00:00.000Z"))
    ).toBe(false);
  });

  it("does not confuse one workspace with another", () => {
    expect(
      requiresRepurgeAfterRestore("ws_2", [tombstone()], new Date("2026-08-01T00:00:00.000Z"))
    ).toBe(false);
  });

  it("re-purges nothing when no deletion ever happened", () => {
    expect(requiresRepurgeAfterRestore("ws_1", [], new Date("2026-08-01T00:00:00.000Z"))).toBe(
      false
    );
  });
});
