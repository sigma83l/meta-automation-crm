import { structureCarriesPersonalData } from "./pii-shapes";

/**
 * Explicit deletion, kept separate from billing.
 *
 * The pack states the distinction bluntly and it is the most important thing in
 * this file:
 *
 *   subscription cancellation = billing lifecycle
 *   explicit deletion         = data lifecycle
 *
 * They are conflated constantly, in both directions, and both directions are
 * bad. Deleting a cancelled customer's data destroys the work of somebody who
 * may simply have paused; leaving a deletion request unactioned because the
 * subscription is still live ignores a legal instruction. Nothing here consults
 * subscription state, and nothing in the billing module deletes.
 *
 * The other load-bearing idea is the tombstone. Deletion has to survive a
 * restore: a backup taken before the purge still contains everything, so a
 * restore without a record of what was deleted resurrects it. The tombstone is
 * the record, and it holds no personal data itself — otherwise it would be the
 * very thing it exists to prove was removed.
 */

export const DELETION_STAGES = [
  /** Requested and waiting out the grace window. Reversible. */
  "requested",
  /** Integrations, tokens and automation stopped. Still reversible. */
  "integrations_disabled",
  /** Rows and objects being removed. No longer reversible. */
  "purging",
  /** Purge complete; tombstone written. */
  "completed",
  /** Stopped by a legal hold or retention exception. */
  "held"
] as const;

export type DeletionStage = (typeof DELETION_STAGES)[number];

/**
 * How long a deletion request waits before it becomes irreversible.
 *
 * Long enough for somebody who clicked it by mistake, or whose account was
 * taken over, to notice and stop it. Short enough to be a credible answer to
 * "delete my data".
 */
export const DELETION_GRACE_HOURS = 72;

export type DeletionRequest = Readonly<{
  stage: DeletionStage;
  requestedAt: string;
  /** Set once the purge passes the point of no return. */
  purgeStartedAt: string | null;
  legalHold: boolean;
  retentionExceptions: readonly string[];
}>;

export type StageVerdict =
  Readonly<{ allowed: true; next: DeletionStage }> | Readonly<{ allowed: false; reason: string }>;

/**
 * Whether a deletion may move to its next stage.
 *
 * Ordered so that everything reversible happens first. Integrations are
 * disabled before anything is purged, because a workspace still receiving
 * webhooks mid-purge writes new rows behind the deletion — and those rows are
 * personal data that nobody will think to look for afterwards.
 */
export function authorizeStageAdvance(request: DeletionRequest, now: Date): StageVerdict {
  if (request.legalHold) {
    return { allowed: false, reason: "legal hold" };
  }

  switch (request.stage) {
    case "requested": {
      const elapsedHours = (now.getTime() - Date.parse(request.requestedAt)) / 3_600_000;
      if (!Number.isFinite(elapsedHours)) {
        return { allowed: false, reason: "request timestamp is unreadable" };
      }
      if (elapsedHours < DELETION_GRACE_HOURS) {
        return { allowed: false, reason: "grace window has not elapsed" };
      }
      return { allowed: true, next: "integrations_disabled" };
    }
    case "integrations_disabled":
      // Retention exceptions are checked here rather than at request time: a
      // legal obligation can arrive after somebody asks to be deleted, and the
      // check that matters is the one immediately before the irreversible step.
      if (request.retentionExceptions.length > 0) {
        return { allowed: false, reason: "retention exception applies" };
      }
      return { allowed: true, next: "purging" };
    case "purging":
      return { allowed: true, next: "completed" };
    case "completed":
      return { allowed: false, reason: "already complete" };
    case "held":
      return { allowed: false, reason: "held" };
  }
}

/**
 * Whether a deletion can still be called off.
 *
 * Reversible right up to the moment the purge starts, and never afterwards.
 * Offering to cancel something that has already destroyed half its rows would
 * leave a workspace in a state nobody can describe.
 */
export function isReversible(request: DeletionRequest): boolean {
  return request.stage === "requested" || request.stage === "integrations_disabled";
}

export type Tombstone = Readonly<{
  workspaceId: string;
  deletedAt: string;
  /** Counts only. A tombstone holding personal data defeats its own purpose. */
  purgedCounts: Readonly<Record<string, number>>;
  storageObjectsPurged: number;
  /** Named subprocessors the deletion was propagated to. */
  subprocessorsNotified: readonly string[];
  requestReason: "owner_request" | "trial_expiry" | "legal_request";
}>;

/**
 * Whether a tombstone is safe to keep.
 *
 * The tombstone outlives the data by design — that is what stops a restore
 * resurrecting a deleted workspace — so anything personal inside it would
 * outlive the deletion too. The check is shape-based rather than name-based
 * because the field that catches somebody out is not called `email`.
 */
export function isTombstoneClean(tombstone: Tombstone): boolean {
  return !structureCarriesPersonalData(tombstone);
}

/**
 * Whether a restored workspace should be re-purged.
 *
 * This is the whole reason tombstones exist. A backup taken before the purge
 * still contains everything, so after a restore the deletion has to be
 * reapplied — and the only way to know it happened is a record that was not
 * itself in the backup's scope.
 */
export function requiresRepurgeAfterRestore(
  workspaceId: string,
  tombstones: readonly Tombstone[],
  restoredFrom: Date
): boolean {
  return tombstones.some(
    (tombstone) =>
      tombstone.workspaceId === workspaceId &&
      Date.parse(tombstone.deletedAt) > restoredFrom.getTime()
  );
}

// Note: nothing in this module reads subscription status, and nothing decides
// deletion from it. Cancellation is a billing event; deletion is a data
// instruction. A cancelled workspace keeps its data, and a paying workspace that
// asks to be deleted is deleted.
