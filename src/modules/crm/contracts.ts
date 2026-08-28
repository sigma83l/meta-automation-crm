import type { StopReason, EligibilityVerdict } from "./followup-policy";
import type {
  AiWritePermission,
  FieldConfidence,
  FieldType,
  FieldWriter
} from "./custom-field-policy";
import type { OpportunityStage, OutcomeSource } from "./opportunity-outcome";
import type { AttentionVerdict } from "./attention-priority";
import type {
  ActionEligibility,
  ActionOwner,
  ActionSource,
  NextActionType,
  ProposedAction
} from "./next-action";
import type { FactConfidence, ProposedFact, StoredFact } from "@/src/modules/rcos/memory-policy";
import type { AiCrmProposal, ClassifiedProposal } from "./ai-write";
import type { NowCard } from "./now-card";
import type { TimelineEvent, TimelineFilter } from "./timeline";
import type { RadarViewFilters } from "./radar-views";
import type {
  EvidenceComponent,
  ScoreConfig,
  ScoreDriver,
  ScoreBlocker
} from "./qualification-score";
import type { LeadStatus, LifecycleStage } from "./revenue-state";

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
  /**
   * Which part of the score this is about. Required, where the column is
   * nullable: the column has to tolerate rows written before the score engine
   * existed, and a new one that cannot say what it is about would contribute
   * nothing anyway.
   */
  component: EvidenceComponent;
  /** -100..100. Negative weights are disqualifiers. */
  weight: number;
  confidence: "inferred" | "high_confidence" | "confirmed" | "human_verified";
  /** Message, note or actor this came from. Never empty. */
  evidenceRef: string;
  /** When this stops being true, if it ever does. */
  expiresAt?: string | null;
}>;

export type StoredEvidence = EvidenceInput &
  Readonly<{ id: string; recordedAt: string; expiresAt: string | null }>;

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

export type FieldDefinitionInput = Readonly<{
  name: string;
  /** Stable identifier; the name is a label and may be renamed freely. */
  fieldKey: string;
  fieldType: FieldType;
  /** Defaults to `never`. A field nobody opted in stays closed to the model. */
  aiWrite?: AiWritePermission;
}>;

export type StoredFieldDefinition = Readonly<{
  id: string;
  name: string;
  fieldKey: string;
  fieldType: FieldType;
  aiWrite: AiWritePermission;
}>;

export type FieldValueInput = Readonly<{
  customerId: string;
  fieldKey: string;
  value: string | number | boolean;
  writer: FieldWriter;
  /** Only meaningful for `confirmed_if_authoritative`. */
  authoritative?: boolean;
  sourceRef: string;
}>;

export type StoredFieldValue = Readonly<{
  customerId: string;
  fieldKey: string;
  value: string | number | boolean;
  writer: FieldWriter;
  confidence: FieldConfidence;
  sourceRef: string;
  updatedAt: string;
}>;

/**
 * `suggested` is not a failure. The field permits the model to propose and not
 * to decide, so the value is withheld rather than rejected, and the caller is
 * the one that knows where a proposal goes.
 */
export type FieldWriteResult =
  | Readonly<{ outcome: "stored"; value: StoredFieldValue }>
  | Readonly<{ outcome: "suggested"; reason: string }>
  | Readonly<{ outcome: "refused"; reason: string }>;

export type ScoreConfigInput = Readonly<{
  version: string;
  components: ScoreConfig["components"];
  disqualifierMin?: number;
}>;

export type StoredScoreConfig = ScoreConfig & Readonly<{ id: string; createdAt: string }>;

export type StoredScoreSnapshot = Readonly<{
  id: string;
  customerId: string;
  score: number;
  components: ScoreConfig["components"];
  disqualifierPenalty: number;
  confidence: number;
  topDrivers: readonly ScoreDriver[];
  topBlockers: readonly ScoreBlocker[];
  configVersion: string;
  evidenceRefs: readonly string[];
  reasonCodes: readonly string[];
  /** Null only on a contact's first snapshot. */
  previousScore: number | null;
  overrideBy: string | null;
  overrideReason: string | null;
  calculatedAt: string;
}>;

export type ScoreConfigResult =
  | Readonly<{ outcome: "stored"; config: StoredScoreConfig }>
  | Readonly<{ outcome: "refused"; reason: string }>;

/**
 * One row of the index, assembled server-side.
 *
 * Priority and next action are computed rather than stored: both are functions
 * of the state beside them and would be a cache with no invalidation. The view
 * supplies the inputs; the ranking happens once, here.
 */
export type RadarRow = Readonly<{
  customerId: string;
  displayName: string;
  companyName: string | null;
  status: "active" | "archived";
  source: string;
  lifecycleStage: LifecycleStage;
  leadStatus: LeadStatus;
  score: number | null;
  priority: AttentionVerdict["priority"];
  reasons: AttentionVerdict["reasons"];
  nextAction: ProposedAction;
  ownerId: string | null;
  channel: string | null;
  lastActivityAt: string;
  updatedAt: string;
  /**
   * What this contact currently wants, in their own terms - null when nobody
   * has established it. The column says Unknown rather than going blank,
   * because a gap an operator can see is one they can close.
   */
  currentNeed: string | null;
  /** How firm that is. A model's inference and a stated need are not the same. */
  currentNeedConfidence: FactConfidence | null;
}>;

export type RadarCursor = Readonly<{ updatedAt: string; customerId: string }>;

export type RadarPage = Readonly<{
  rows: readonly RadarRow[];
  /** Null when this was the last page. */
  nextCursor: RadarCursor | null;
}>;

/**
 * A page request: a view's filters, plus what the operator typed and where the
 * last page stopped.
 *
 * `attention` is the one filter no column answers, so the repository applies it
 * to the ranked row and reads further when a page comes back short.
 */
export type RadarQuery = RadarViewFilters &
  Readonly<{
    query?: string;
    limit?: number;
    cursor?: RadarCursor | null;
  }>;

export type SavedView = Readonly<{
  id: string;
  name: string;
  filters: RadarViewFilters;
  createdAt: string;
}>;

/**
 * What one applied proposal did.
 *
 * The classification is returned in full rather than as counts: an operator
 * reviewing what a model changed needs to see the writes it refused as much as
 * the ones it made, and a count cannot say which fact was conflicted.
 */
export type AiWriteOutcome = Readonly<{
  classified: ClassifiedProposal;
  /** Facts durable after the write. Short of the accepted count means storage failed. */
  remembered: number;
  score: StoredScoreSnapshot;
  transition: TransitionResult | null;
  /** Computed, never stored: it is a function of the state just written. */
  nextAction: ProposedAction;
}>;

export type SavedViewInput = Readonly<{ name: string; filters: RadarViewFilters }>;

export type ActionProposalInput = Readonly<{
  customerId: string;
  type: NextActionType;
  reasonCodes: readonly string[];
  evidenceRefs?: readonly string[];
  ownerType: ActionOwner;
  ownerId?: string | null;
  dueAt?: string | null;
  eligibility?: ActionEligibility;
  confidence?: number;
  source: Exclude<ActionSource, "derived">;
}>;

export type StoredActionProposal = Readonly<{
  id: string;
  customerId: string;
  type: NextActionType;
  reasonCodes: readonly string[];
  evidenceRefs: readonly string[];
  ownerType: ActionOwner;
  ownerId: string | null;
  dueAt: string | null;
  eligibility: ActionEligibility;
  confidence: number;
  source: ActionSource;
  settledAt: string | null;
  settledOutcome: "accepted" | "rejected" | "superseded" | null;
  proposedAt: string;
}>;

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
  /** Defines a workspace custom field. */
  defineCustomField(input: FieldDefinitionInput): Promise<StoredFieldDefinition>;
  /** Every field this workspace has defined. */
  customFieldDefinitions(): Promise<readonly StoredFieldDefinition[]>;
  /** Sets one field on one customer, subject to its type and its ai_write rule. */
  setCustomFieldValue(input: FieldValueInput): Promise<FieldWriteResult>;
  /** One customer's field values. */
  customFieldValuesFor(customerId: string): Promise<readonly StoredFieldValue[]>;
  /** Stores a new score config version, or says why the weights are unusable. */
  saveScoreConfig(input: ScoreConfigInput): Promise<ScoreConfigResult>;
  /** The config a score would be computed against right now. */
  activeScoreConfig(): Promise<ScoreConfig>;
  /** Recomputes one customer's score from current evidence and stores a snapshot. */
  rescoreCustomer(customerId: string, now?: Date): Promise<StoredScoreSnapshot>;
  /** The most recent snapshot, or null if this customer has never been scored. */
  latestScore(customerId: string): Promise<StoredScoreSnapshot | null>;
  /** Replaces the computed score with a person's judgement, on the record. */
  overrideScore(
    customerId: string,
    score: number,
    reason: string,
    now?: Date
  ): Promise<StoredScoreSnapshot>;
  /**
   * What this contact needs from an operator right now.
   *
   * Computed on read and never stored: priority is a function of current state
   * and goes stale the moment anything moves, so a persisted one would be a
   * cache with no invalidation.
   */
  attentionFor(customerId: string, now?: Date): Promise<AttentionVerdict>;
  /** One contact as the index sees them: same row, same ranking. */
  radarRowFor(customerId: string, now?: Date): Promise<RadarRow>;
  /**
   * The record's Now card, assembled on read for the same reason: every field
   * is a function of current state, and a stored one would go stale silently.
   */
  nowCardFor(customerId: string, now?: Date): Promise<NowCard>;
  /**
   * One contact's history, newest first. Routine machinery - automation
   * internals, refreshes that changed nothing - is left out unless asked for.
   */
  timelineFor(
    customerId: string,
    filter?: TimelineFilter,
    limit?: number
  ): Promise<readonly TimelineEvent[]>;
  /** What is remembered about this contact, newest first, with its provenance. */
  memoryFor(customerId: string): Promise<readonly StoredFact[]>;
  /** Stores accepted facts. Returns how many are durable rather than throwing. */
  rememberFacts(customerId: string, facts: readonly ProposedFact[]): Promise<number>;
  /**
   * Applies a model's proposal and recomputes what follows from it: score,
   * lifecycle eligibility, next action. The proposal is an application-owned
   * shape, so nothing in it can name a column or a query.
   */
  applyAiProposal(customerId: string, proposal: AiCrmProposal, now?: Date): Promise<AiWriteOutcome>;
  /** Every follow-up for one contact, soonest due first - not only the live ones. */
  followUpsFor(customerId: string): Promise<readonly StoredFollowUp[]>;
  /**
   * One page of the index, with priority and next action computed per row.
   *
   * Cursor rather than offset: an offset page shifts under anybody editing a
   * record while somebody else pages through, silently skipping rows.
   */
  radar(query?: RadarQuery, now?: Date): Promise<RadarPage>;
  /**
   * Records a proposal a model or a person made. Never executes it - execution
   * belongs to the domain that owns the send.
   */
  proposeAction(input: ActionProposalInput): Promise<StoredActionProposal>;
  /** Live proposals for one contact, newest first. */
  proposalsFor(customerId: string): Promise<readonly StoredActionProposal[]>;
  /** The workspace's own views, oldest first, beside the seven built-in ones. */
  savedViews(): Promise<readonly SavedView[]>;
  /** Defines one. The filters are values from fixed vocabularies, never a query. */
  saveView(input: SavedViewInput): Promise<SavedView>;
  deleteSavedView(viewId: string): Promise<void>;
  /** Marks a proposal acted on, so a rejected suggestion stays visible. */
  settleProposal(
    proposalId: string,
    outcome: "accepted" | "rejected" | "superseded"
  ): Promise<StoredActionProposal>;
}
