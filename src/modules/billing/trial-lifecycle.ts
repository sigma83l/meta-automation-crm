/**
 * What happens to a trial workspace as the clock runs out.
 *
 * The pack lays out a staged wind-down rather than a switch, and the staging is
 * the substance: outbound stops on day 7, inbound keeps landing for another 72
 * hours, the data stays readable for two weeks, and only then does deletion get
 * scheduled. Each stage exists to stop a different kind of damage.
 *
 * The one that matters most is the ingestion window. A trial ending does not
 * tell the customer's customers to stop messaging them, and dropping those
 * messages on the hour would lose real conversations belonging to people who
 * never agreed to anything. So ingestion outlives sending.
 *
 * Pure and clock-injected: every boundary below is a date comparison, and a
 * function that reads the clock itself cannot be tested at the boundary, which
 * is the only place these are ever interesting.
 */

export const TRIAL_DURATION_DAYS = 7;
/** Inbound keeps landing this long after outbound stops. */
export const INGESTION_WINDOW_HOURS = 72;
/** Read-only and export remain available this long after the trial ends. */
export const READ_ONLY_DAYS = 14;
/** Deletion is scheduled by this point unless a retention policy applies. */
export const DELETION_DAY = 30;

export const TRIAL_PHASES = [
  /** Sandbox available; live connection still gated. */
  "active",
  /**
   * Day 7 passed. Outbound stops immediately and inbound keeps landing, so
   * this is one phase and not two: the moment sending stops is the moment the
   * ingestion window opens.
   */
  "ingestion_window",
  /** Integrations suspended; data readable and exportable. */
  "read_only",
  /** Cleanup scheduled. */
  "pending_deletion"
] as const;

export type TrialPhase = (typeof TRIAL_PHASES)[number];

export type TrialCapabilities = Readonly<{
  /** May AI and automation send to customers? */
  outboundSend: boolean;
  /** May inbound webhooks still be accepted and stored? */
  inboundIngestion: boolean;
  /** May a human read the workspace? */
  readAccess: boolean;
  /** May they export? */
  export: boolean;
  /** May they upgrade and carry on? */
  upgrade: boolean;
}>;

const DAY_MS = 24 * 60 * 60 * 1000;

export function trialPhaseAt(trialEndsAt: Date, now: Date): TrialPhase {
  const elapsedMs = now.getTime() - trialEndsAt.getTime();
  if (elapsedMs < 0) return "active";
  if (elapsedMs < INGESTION_WINDOW_HOURS * 60 * 60 * 1000) return "ingestion_window";
  if (elapsedMs < READ_ONLY_DAYS * DAY_MS) return "read_only";
  return "pending_deletion";
}

/**
 * What a workspace may do in each phase.
 *
 * Upgrade stays available in every phase including pending deletion, and the
 * data survives to support it. Somebody returning on day 25 to pay should get
 * their workspace back, not a condolence message — and the pack requires that
 * an upgrade preserve workspace and context at any point.
 */
export function trialCapabilitiesFor(phase: TrialPhase): TrialCapabilities {
  switch (phase) {
    case "active":
      return {
        outboundSend: true,
        inboundIngestion: true,
        readAccess: true,
        export: true,
        upgrade: true
      };
    case "ingestion_window":
      // Outbound stops, inbound does not. A trial ending does not tell the
      // customer's customers to stop messaging them.
      return {
        outboundSend: false,
        inboundIngestion: true,
        readAccess: true,
        export: true,
        upgrade: true
      };
    case "read_only":
      return {
        outboundSend: false,
        inboundIngestion: false,
        readAccess: true,
        export: true,
        upgrade: true
      };
    case "pending_deletion":
      // Still readable and still upgradeable: the deletion is scheduled, not
      // done, and somebody arriving late to pay should find their work intact.
      return {
        outboundSend: false,
        inboundIngestion: false,
        readAccess: true,
        export: true,
        upgrade: true
      };
  }
}

export type TrialSchedule = Readonly<{
  trialEndsAt: string;
  ingestionClosesAt: string;
  readOnlyUntil: string;
  deletionScheduledFor: string;
}>;

export function trialScheduleFrom(startedAt: Date): TrialSchedule {
  const endsAt = new Date(startedAt.getTime() + TRIAL_DURATION_DAYS * DAY_MS);
  return Object.freeze({
    trialEndsAt: endsAt.toISOString(),
    ingestionClosesAt: new Date(
      endsAt.getTime() + INGESTION_WINDOW_HOURS * 60 * 60 * 1000
    ).toISOString(),
    readOnlyUntil: new Date(endsAt.getTime() + READ_ONLY_DAYS * DAY_MS).toISOString(),
    deletionScheduledFor: new Date(startedAt.getTime() + DELETION_DAY * DAY_MS).toISOString()
  });
}

export type DeletionVerdict =
  Readonly<{ delete: true }> | Readonly<{ delete: false; reason: string }>;

/**
 * Whether a trial workspace's cleanup may actually proceed.
 *
 * Fails closed on every count. Deletion is the one action in this file that
 * cannot be walked back, so it requires the schedule to have elapsed, no
 * subscription to have appeared, and no retention policy to apply — and an
 * unknown answer to any of those is a reason not to delete, never a reason to
 * carry on.
 */
export function authorizeTrialDeletion(
  input: Readonly<{
    deletionScheduledFor: string;
    hasSubscription: boolean;
    retentionPolicyApplies: boolean;
    legalHold: boolean;
    now: Date;
  }>
): DeletionVerdict {
  if (input.hasSubscription) {
    return { delete: false, reason: "workspace has a subscription" };
  }
  if (input.legalHold) {
    return { delete: false, reason: "legal hold" };
  }
  if (input.retentionPolicyApplies) {
    return { delete: false, reason: "retention policy applies" };
  }
  const scheduled = Date.parse(input.deletionScheduledFor);
  if (!Number.isFinite(scheduled)) {
    // An unreadable schedule is not permission to delete now.
    return { delete: false, reason: "deletion schedule is unreadable" };
  }
  if (scheduled > input.now.getTime()) {
    return { delete: false, reason: "scheduled date has not passed" };
  }
  return { delete: true };
}

// Note: there is deliberately no upgradePreservesWorkspace() here. The pack
// requires that an upgrade at any point preserves workspace and context, and
// the way that requirement gets broken in practice is a "clean start" on
// conversion - which no function returning true can prevent. What enforces it
// is that upgrading is a status change on the existing workspace and nothing
// in this module creates a new one; the trial data is simply still there.
