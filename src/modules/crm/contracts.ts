import type { StopReason, EligibilityVerdict } from "./followup-policy";
import type { OpportunityStage, OutcomeSource } from "./opportunity-outcome";
import type { LifecycleStage } from "./revenue-state";

export type CustomerSummary = Readonly<{
  id: string;
  displayName: string;
  companyName: string | null;
  status: "active" | "archived";
  source: string;
  createdAt: string;
}>;

export type CustomerInput = Readonly<{
  displayName: string;
  companyName?: string | null;
  email?: string;
  phone?: string;
}>;

export type CustomerFilters = Readonly<{
  query?: string;
  status?: "active" | "archived";
}>;

/**
 * One reason a customer scores the way they do.
 *
 * `evidenceRef` is required and `QualificationSignal` in revenue-state.ts leaves
 * it optional. The stricter shape is the one that gets stored: the pack's rule
 * is that every non-zero contribution maps to evidence, and a stored row is
 * exactly where an unsourced weight would become permanent. The pure scorer can
 * stay lenient because it computes and forgets; this does not.
 */
export type EvidenceInput = Readonly<{
  customerId: string;
  /** What was observed, from the workspace's signal vocabulary. */
  signal: string;
  /** -100..100. Negative weights are disqualifiers. */
  weight: number;
  confidence: "inferred" | "high_confidence" | "confirmed" | "human_verified";
  /** Message, note or actor this came from. Never empty. */
  evidenceRef: string;
}>;

export type StoredEvidence = EvidenceInput & Readonly<{ id: string; recordedAt: string }>;

/** A stage change, with the reason that authorised it. */
export type TransitionInput = Readonly<{
  customerId: string;
  /** The stage the caller saw. A mismatch means somebody else moved it first. */
  from: LifecycleStage;
  to: LifecycleStage;
  reasonCodes: readonly string[];
  evidenceRef?: string | null;
  /** A user id, or a system identifier for an automated move. */
  actor: string;
}>;

export type StoredLifecycleEvent = Readonly<{
  id: string;
  customerId: string;
  from: LifecycleStage | null;
  to: LifecycleStage;
  reasonCodes: readonly string[];
  evidenceRef: string | null;
  actor: string;
  occurredAt: string;
}>;

/**
 * Why this is a result and not an exception.
 *
 * `refused` and `stale` are both ordinary outcomes rather than faults. A
 * refusal means the rules said no, which callers act on. `stale` means somebody
 * moved the customer first - two operators on one record is normal, and the
 * caller's move was decided against a stage that no longer holds. Throwing
 * would make both indistinguishable from a database being down.
 */
export type TransitionResult =
  | Readonly<{ outcome: "recorded"; event: StoredLifecycleEvent }>
  | Readonly<{ outcome: "refused"; reason: string }>
  | Readonly<{ outcome: "stale"; reason: string }>;

export const FOLLOWUP_OWNERS = ["human", "automation", "ai_suggestion_accepted", "system"] as const;
export type FollowUpOwner = (typeof FOLLOWUP_OWNERS)[number];

export type FollowUpInput = Readonly<{
  customerId: string;
  stopReason: StopReason;
  /** What this follow-up is for. Defaults to the reason's own objective. */
  objective?: string;
  /** What would make it unnecessary. Defaults to the reason's own condition. */
  cancelCondition?: string;
  dueAt: string;
  ownerType: FollowUpOwner;
  /** Required for a human owner, forbidden for every other kind. */
  ownerId?: string | null;
  messageVersion?: string;
}>;

export type StoredFollowUp = Readonly<{
  id: string;
  customerId: string;
  stopReason: StopReason;
  objective: string;
  cancelCondition: string;
  eligibilityState: "eligible" | "blocked" | "cancelled" | "completed";
  messageVersion: string;
  dueAt: string;
  attempts: number;
  ownerType: FollowUpOwner;
  ownerId: string | null;
  lastResult: string | null;
  nextEligibleAt: string | null;
}>;

export type OpportunityInput = Readonly<{
  customerId: string;
  /** A band, never an amount: an estimated figure would look authoritative. */
  valueBand?: "unknown" | "low" | "medium" | "high";
  ownerId?: string | null;
  nextAction?: string | null;
}>;

export type OutcomeInput = Readonly<{
  stage: OpportunityStage;
  source: OutcomeSource;
  evidenceRef?: string | null;
  lostReason?: string | null;
}>;

export type StoredOpportunity = Readonly<{
  id: string;
  customerId: string;
  stage: OpportunityStage;
  valueBand: "unknown" | "low" | "medium" | "high" | null;
  ownerId: string | null;
  nextAction: string | null;
  lostReason: string | null;
  outcomeSource: OutcomeSource | null;
  outcomeEvidenceRef: string | null;
  outcomeRecordedAt: string | null;
}>;

export type OutcomeResult =
  | Readonly<{ outcome: "recorded"; opportunity: StoredOpportunity }>
  | Readonly<{ outcome: "refused"; reason: string }>;

export interface CrmRepository {
  list(filters: CustomerFilters): Promise<readonly CustomerSummary[]>;
  create(input: CustomerInput): Promise<CustomerSummary>;
  update(customerId: string, input: CustomerInput): Promise<CustomerSummary>;
  detail(customerId: string): Promise<Readonly<Record<string, unknown>>>;
  /** Appends one piece of evidence. Evidence is never edited, only superseded. */
  recordEvidence(input: EvidenceInput): Promise<StoredEvidence>;
  /** Every recorded signal for one customer, newest first. */
  evidenceFor(customerId: string): Promise<readonly StoredEvidence[]>;
  /** Moves the stage and records why, or explains why it did not. */
  transitionLifecycle(input: TransitionInput): Promise<TransitionResult>;
  /** One customer's stage history, newest first. */
  lifecycleFor(customerId: string): Promise<readonly StoredLifecycleEvent[]>;
  /** Queues a follow-up. Rejects one that cannot say what it is for. */
  scheduleFollowUp(input: FollowUpInput): Promise<StoredFollowUp>;
  /** Eligible follow-ups due at `now` and not deferred past it. */
  dueFollowUps(now: string): Promise<readonly StoredFollowUp[]>;
  /**
   * Applies an execution-time verdict.
   *
   * A terminal refusal cancels; a non-terminal one defers, because the
   * condition that blocked it can clear and the follow-up is still wanted.
   */
  settleFollowUp(
    followUpId: string,
    verdict: EligibilityVerdict,
    deferUntil?: string
  ): Promise<StoredFollowUp>;
  /** Records an attempt and what came of it. */
  recordFollowUpAttempt(followUpId: string, result: string): Promise<StoredFollowUp>;
  /** Opens an opportunity. It starts unsettled and cites nothing. */
  openOpportunity(input: OpportunityInput): Promise<StoredOpportunity>;
  /** One customer's opportunities, newest first. */
  opportunitiesFor(customerId: string): Promise<readonly StoredOpportunity[]>;
  /** Settles one, or explains why the claim was not permitted. */
  settleOpportunity(opportunityId: string, outcome: OutcomeInput): Promise<OutcomeResult>;
}
