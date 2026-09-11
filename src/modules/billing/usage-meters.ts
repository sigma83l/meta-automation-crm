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
  /**
   * Weighted managed-AI work, not a count of replies.
   *
   * `ai_reply` counted one per answer, which priced a one-line lookup against
   * approved hours the same as a reasoned reply to a complaint. The two differ
   * by more than an order of magnitude in what they cost to serve, so the
   * cheaper one was subsidising the dearer one and neither price meant
   * anything. The old meter is kept below so historical rows stay readable.
   */
  "ai_work_units",
  "automation_actions",
  "connector_units",
  "seat",
  "media_bytes",
  /** Retired in favour of `ai_work_units`. Nothing writes it. */
  "ai_reply",
  /** Retired in favour of `automation_actions`. Nothing writes it. */
  "automation_action"
] as const;

export type UsageMeter = (typeof USAGE_METERS)[number];

/**
 * What one turn of managed AI costs the customer, in work units.
 *
 * The weights are the commercial pack's, and the classes are its words. What
 * this function owns is the mapping from something the engine actually knows -
 * which router role answered, and whether a tool ran - onto those classes.
 *
 * The mapping is a judgement, and it is the one to revisit when real usage
 * arrives: the pack names six classes and the router has four customer-facing
 * roles, so `escalation` covers both of the dearest classes and is separated
 * only by whether the turn also drove a tool.
 *
 * Two properties are deliberate rather than incidental:
 *
 *   - **Zero when nothing was sent.** A draft the validator refused cost us
 *     tokens, but charging for a reply the customer never received is
 *     indefensible and removes our own incentive to stop producing them. This
 *     is the same rule `aiReplyCounts` already applies, and the two must not
 *     disagree or the invoice and the usage page will.
 *   - **Zero for a handoff.** The pack is explicit that the handoff action
 *     itself carries no AI units. Asking for a person is the outcome we want
 *     when the alternative is a guess, and pricing it would discourage it.
 */
export const AI_WORK_UNIT_WEIGHTS = Object.freeze({
  deterministic_rule_or_cached_answer: 0,
  economy_grounded_reply: 1,
  standard_reasoning_reply: 2,
  long_context_or_single_tool_plan: 3,
  complex_multi_step_or_multi_tool_plan: 5,
  premium_draft_or_high_complexity: 8
});

/** The router roles that can reach a customer, as `selectReplyModel` returns them. */
export type BilledReplyRole = "deterministic" | "lookup" | "primary" | "escalation";

export function workUnitsFor(
  input: Readonly<{
    role: BilledReplyRole;
    outcome: AiReplyOutcome;
    /** Whether the turn also executed a tool. */
    toolExecuted?: boolean;
  }>
): number {
  if (!aiReplyCounts(input.outcome, true)) return 0;
  const withTool = input.toolExecuted === true;
  switch (input.role) {
    case "deterministic":
      return AI_WORK_UNIT_WEIGHTS.deterministic_rule_or_cached_answer;
    case "lookup":
      return AI_WORK_UNIT_WEIGHTS.economy_grounded_reply;
    case "primary":
      return withTool
        ? AI_WORK_UNIT_WEIGHTS.long_context_or_single_tool_plan
        : AI_WORK_UNIT_WEIGHTS.standard_reasoning_reply;
    case "escalation":
      return withTool
        ? AI_WORK_UNIT_WEIGHTS.premium_draft_or_high_complexity
        : AI_WORK_UNIT_WEIGHTS.complex_multi_step_or_multi_tool_plan;
  }
}

/**
 * The idempotency key for a turn's AI usage.
 *
 * One row per event, so a redelivered provider webhook that re-runs the same
 * turn cannot bill twice. `sendRefFor` is not reused here: it keys a send, and
 * a turn that never sent still has to be able to record a zero.
 */
export function workUnitsIdempotencyKey(eventId: string): string {
  return `ai_work_units:${eventId}`;
}

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

/**
 * A limit per meter, where one exists.
 *
 * Partial on purpose. The 2026-09-v2 catalogue meters things the legacy Paddle
 * catalogue never did, and a plan may legitimately not cap something -- Business
 * and Agency have fair use on workflows rather than a number. A meter with no
 * limit is unmetered, not zero-limited, and `authorizeUsage` says so.
 */
export type MeterLimits = Readonly<Partial<Record<UsageMeter, number>>>;

/**
 * Limits as the plan catalogue records them, from `subscription_plans`.
 *
 * The source of truth for 2026-09-v2 is the database row, not the Paddle
 * catalogue file: the file describes the retired sandbox model and its shape
 * has no place to put work units or connector units. Null columns stay absent
 * rather than becoming zero, which is the difference between "fair use" and
 * "you may do none of this".
 */
export type PlanLimitRow = Readonly<{
  mac: number | null;
  ai_work_units: number | null;
  automation_actions: number | null;
  connector_units: number | null;
  seats: number | null;
  storage_mb: number | null;
}>;

export function limitsForPlanRow(row: PlanLimitRow): MeterLimits {
  const only = (value: number | null, meter: UsageMeter) =>
    typeof value === "number" ? { [meter]: value } : {};
  return Object.freeze({
    ...only(row.mac, "mac"),
    ...only(row.ai_work_units, "ai_work_units"),
    ...only(row.automation_actions, "automation_actions"),
    ...only(row.connector_units, "connector_units"),
    ...only(row.seats, "seat"),
    // Megabytes in the catalogue, bytes in the ledger. Converted here so the
    // two units never meet anywhere else.
    ...(typeof row.storage_mb === "number" ? { media_bytes: row.storage_mb * 1024 * 1024 } : {})
  });
}

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
  // No limit recorded is unmetered, not a limit of zero. Reading an absent
  // number as zero would stop every plan that leaves something to fair use.
  if (limit === undefined) return { allowed: true, state: "ok" };
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
  // Both vocabularies are read, newest first. A trial that started under the
  // retired meters must still pause on the numbers it was sold, and a limit
  // nobody recorded is unmetered rather than exhausted - the reverse would
  // pause the assistant on every plan that leaves a meter to fair use.
  const exhausted = (meters: readonly UsageMeter[]): boolean =>
    meters.some((meter) => {
      const limit = limits[meter];
      return limit !== undefined && (totals[meter] ?? 0) >= limit;
    });

  if (exhausted(["ai_work_units", "ai_reply"])) {
    return { aiPaused: true, manualAllowed: true, reason: "ai_reply_quota_reached" };
  }
  if (exhausted(["automation_actions", "automation_action"])) {
    return { aiPaused: true, manualAllowed: true, reason: "automation_quota_reached" };
  }
  return { aiPaused: false, manualAllowed: true, reason: null };
}
