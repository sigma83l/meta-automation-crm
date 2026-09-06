import type { PlanEntitlements } from "./providers/paddle/catalogue";

/**
 * What counts, and what does not.
 *
 * The pack's meter table is short but every line of it is a decision that costs
 * money in one direction or trust in the other. The two that matter most:
 *
 *   - A failed or rejected send counts as zero. Charging somebody for a reply
 *     their customer never received is indefensible, and it also removes our
 *     own incentive to fix delivery.
 *   - Internal AI — classification, extraction, summarising, routing — is
 *     telemetry, not customer quota. The customer asked for replies, not for
 *     however many calls our pipeline needed to produce one; metering internals
 *     would mean a refactor changes somebody's bill.
 *
 * Pure. The ledger rows these describe live in the usage_ledger migration.
 */

export const USAGE_METERS = [
  "mac",
  "ai_reply",
  "automation_action",
  "seat",
  "media_bytes"
] as const;

export type UsageMeter = (typeof USAGE_METERS)[number];

export type UsageEvent = Readonly<{
  meter: UsageMeter;
  quantity: number;
  contactId?: string;
  /** The same source event may be delivered repeatedly; this deduplicates it. */
  idempotencyKey: string;
  sourceEventRef?: string;
  modelRef?: string;
  inputTokens?: number;
  outputTokens?: number;
}>;

export type AiReplyOutcome = "sent" | "sent_unknown" | "failed" | "rejected_by_validator";

/**
 * Whether a generative reply counts against the customer's quota.
 *
 * `sent_unknown` counts. The provider accepted it and we cannot prove it did
 * not arrive; treating that as free would let an ambiguous send be the cheapest
 * kind, which is precisely backwards. It is also the same semantics the outbox
 * already uses for delivery, so the two do not disagree.
 */
export function aiReplyCounts(outcome: AiReplyOutcome, customerFacing: boolean): boolean {
  if (!customerFacing) return false;
  return outcome === "sent" || outcome === "sent_unknown";
}

/**
 * Whether an automation action counts.
 *
 * A technical retry of the same action does not: the workspace asked for one
 * thing to happen, and our infrastructure failing at it the first time is not
 * something to bill for. The idempotency key is what distinguishes a retry from
 * a genuine second execution, which is why it is required rather than optional.
 */
export function automationActionCounts(executed: boolean, isTechnicalRetry: boolean): boolean {
  return executed && !isTechnicalRetry;
}

/**
 * The MAC idempotency key.
 *
 * MAC is `Unique(workspace, cycle, contact)`, so the key must collapse every
 * subsequent interaction with the same contact in the same cycle onto one row.
 */
export function macIdempotencyKey(cycleId: string, contactId: string): string {
  return `mac:${cycleId}:${contactId}`;
}

export type UsageTotals = Readonly<Partial<Record<UsageMeter, number>>>;

export type CapState = "ok" | "approaching" | "reached";

/** Where the warning threshold sits. Late enough to mean something, early
 * enough to act on. */
export const APPROACHING_THRESHOLD = 0.8;

export function capStateFor(used: number, limit: number): CapState {
  if (limit <= 0) return "reached";
  if (used >= limit) return "reached";
  return used / limit >= APPROACHING_THRESHOLD ? "approaching" : "ok";
}

export type MeterLimits = Readonly<Record<UsageMeter, number>>;

export function limitsForEntitlements(entitlements: PlanEntitlements): MeterLimits {
  return Object.freeze({
    mac: entitlements.monthlyActiveContacts,
    ai_reply: entitlements.aiRepliesPerCycle,
    automation_action: entitlements.automationActionsPerCycle,
    seat: entitlements.seats,
    media_bytes: entitlements.mediaBytes
  });
}

export type QuotaVerdict =
  | Readonly<{ allowed: true; state: CapState }>
  | Readonly<{ allowed: false; meter: UsageMeter; used: number; limit: number }>;

/**
 * Whether one more unit of a meter may be consumed.
 *
 * Checked before the work, not after: a cap discovered afterwards has already
 * cost the customer a message they cannot unsend.
 */
export function authorizeUsage(
  meter: UsageMeter,
  totals: UsageTotals,
  limits: MeterLimits,
  quantity = 1
): QuotaVerdict {
  const used = totals[meter] ?? 0;
  const limit = limits[meter];
  if (used + quantity > limit) {
    return { allowed: false, meter, used, limit };
  }
  return { allowed: true, state: capStateFor(used + quantity, limit) };
}

export type TrialPause = Readonly<{
  /** AI auto-reply and AI-triggered automation stop. */
  aiPaused: boolean;
  /** Humans keep working the inbox regardless. */
  manualAllowed: boolean;
  reason: string | null;
}>;

/**
 * What happens when a trial exhausts its AI quota before day 7.
 *
 * The pack is specific and the specificity is the point: AI pauses, manual
 * continues to the end of the trial. Cutting a workspace off from its own
 * inbox because a quota ran out would strand conversations with real customers
 * in them, who never agreed to our billing model.
 */
export function trialPauseFor(totals: UsageTotals, limits: MeterLimits): TrialPause {
  const aiUsed = totals.ai_reply ?? 0;
  if (aiUsed >= limits.ai_reply) {
    return { aiPaused: true, manualAllowed: true, reason: "ai_reply_quota_reached" };
  }
  const actionsUsed = totals.automation_action ?? 0;
  if (actionsUsed >= limits.automation_action) {
    return { aiPaused: true, manualAllowed: true, reason: "automation_quota_reached" };
  }
  return { aiPaused: false, manualAllowed: true, reason: null };
}
