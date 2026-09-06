import { authorizeAction, mayClaimSuccess, type ActionAttempt } from "./action-safety";
import { applyMemoryWrites, type ProposedFact, type StoredFact } from "./memory-policy";
import { safeResolution, validateReply, type ValidationContext } from "./validator";

/**
 * The twelve-step turn pipeline.
 *
 * Every inbound message follows the same path, in the same order, whatever the
 * channel or the model. The ordering is the safety property: deduplication
 * before work, policy before any model call, an authoritative result before any
 * claim of success, validation before sending, and a commit before the send so
 * a crash between them cannot produce a message with no record of it.
 *
 * The engine owns the sequence and the invariants; everything that touches the
 * outside world is an injected port. That keeps the whole pipeline exercisable
 * without a model, a provider or a database, and means the guarantees hold no
 * matter what a port returns.
 */

export type TurnEvent = Readonly<{
  eventId: string;
  workspaceId: string;
  conversationId: string;
  channel: "whatsapp" | "instagram";
  text: string;
  occurredAt: string;
}>;

export type TurnPolicy = Readonly<{
  canSend: boolean;
  allowedActions: readonly string[];
  blockedReason?: string;
}>;

export type TurnUnderstanding = Readonly<{
  intents: readonly Readonly<{ name: string; confidence: number }>[];
  locale: string;
}>;

export type RetrievedFact = Readonly<{ ref: string; value: string }>;

export type ToolRequest = Readonly<{
  actionName: string;
  actionClass: ActionAttempt["actionClass"];
  idempotencyKey?: string;
  hasHumanApproval?: boolean;
}>;

export type TurnDecision = Readonly<{
  type: "answer" | "clarify" | "qualify" | "book" | "handoff" | "wait";
  priority: DecisionPriority;
  reasonCodes: readonly string[];
  toolRequest?: ToolRequest;
  memoryWrites?: readonly ProposedFact[];
}>;

export type ToolOutcome = Readonly<{ authoritative: boolean; summary: string }>;

export type ComposedReply = Readonly<{
  text: string;
  citedRefs: readonly string[];
  claimsCompletion: boolean;
}>;

export type TurnPorts = Readonly<{
  /** Step 1. False means this event was already handled. */
  isNewEvent(event: TurnEvent): Promise<boolean>;
  /** Steps 2 and 3. */
  hydrate(event: TurnEvent): Promise<Readonly<{ facts: readonly StoredFact[] }>>;
  /** Step 4. */
  evaluatePolicy(event: TurnEvent): Promise<TurnPolicy>;
  /** Step 5. The first call that may involve a model. */
  understand(event: TurnEvent): Promise<TurnUnderstanding>;
  /** Step 6. */
  retrieve(
    event: TurnEvent,
    understanding: TurnUnderstanding
  ): Promise<
    Readonly<{
      facts: readonly RetrievedFact[];
      approvedAmounts: readonly string[];
      approvedTimes: readonly string[];
    }>
  >;
  /** Step 7. */
  decide(event: TurnEvent, understanding: TurnUnderstanding): Promise<TurnDecision>;
  /** Step 8. Only reached for an authorised tool request. */
  executeTool(request: ToolRequest): Promise<ToolOutcome>;
  /** Step 9. */
  compose(event: TurnEvent, decision: TurnDecision): Promise<ComposedReply>;
  /**
   * Step 10, continued. Stores the writes the memory policy accepted and
   * returns how many are durable.
   *
   * Returns a count rather than throwing because remembering is not what the
   * turn is for: a customer who gets no reply because a fact could not be
   * filed is worse off than one whose fact was not filed. The count is how the
   * engine tells the difference, so a port that cannot store must report zero
   * rather than succeed quietly.
   */
  persistFacts(event: TurnEvent, facts: readonly ProposedFact[]): Promise<number>;
  /** Step 11. Must persist before anything is sent. */
  commit(record: TurnRecord): Promise<void>;
  /** Step 11, continued. */
  send(reply: ComposedReply, sendRef: string): Promise<void>;
  /** Step 12. Runs whatever the outcome. */
  observe(record: TurnRecord): Promise<void>;
  /** Send refs already used for this conversation. */
  sentRefs(event: TurnEvent): Promise<readonly string[]>;
}>;

/**
 * P0 safety and policy outrank everything; nice-to-have learning outranks
 * nothing. A decision may never be executed above the priority it declared.
 */
export const DECISION_PRIORITIES = [
  "p0_safety_policy",
  "p1_explicit_request",
  "p2_preserve_context",
  "p3_move_to_outcome",
  "p4_improve_qualification",
  "p5_learning"
] as const;

export type DecisionPriority = (typeof DECISION_PRIORITIES)[number];

export function outranks(left: DecisionPriority, right: DecisionPriority): boolean {
  return DECISION_PRIORITIES.indexOf(left) < DECISION_PRIORITIES.indexOf(right);
}

/** Chooses the most urgent decision. Ties keep the earlier candidate. */
export function highestPriority(candidates: readonly TurnDecision[]): TurnDecision | undefined {
  return candidates.reduce<TurnDecision | undefined>(
    (best, candidate) => (!best || outranks(candidate.priority, best.priority) ? candidate : best),
    undefined
  );
}

/**
 * The idempotency key for a turn's send.
 *
 * Exported because two places need it and they must agree: the engine passes it
 * to `send`, and whatever persists the turn has to record the same string for
 * `sentRefs` to recognise it later. Two literals would drift the first time
 * either changed, and the symptom would be a reply sent twice.
 */
export function sendRefFor(turn: Readonly<{ conversationId: string; eventId: string }>): string {
  return `${turn.conversationId}:${turn.eventId}`;
}

export type TurnOutcome =
  "duplicate" | "policy_blocked" | "sent" | "handoff" | "safe_acknowledgement" | "tool_refused";

export type TurnRecord = Readonly<{
  eventId: string;
  workspaceId: string;
  conversationId: string;
  outcome: TurnOutcome;
  reasonCodes: readonly string[];
  acceptedMemoryWrites: number;
  refusedMemoryWrites: number;
  toolExecuted: boolean;
}>;

/**
 * Runs one turn.
 *
 * Returns the record rather than throwing on a refusal: a blocked turn is a
 * normal outcome that must be observed, not an error to be swallowed.
 */
export async function runTurn(event: TurnEvent, ports: TurnPorts): Promise<TurnRecord> {
  const base = {
    eventId: event.eventId,
    workspaceId: event.workspaceId,
    conversationId: event.conversationId,
    acceptedMemoryWrites: 0,
    refusedMemoryWrites: 0,
    toolExecuted: false
  };

  const finish = async (record: TurnRecord): Promise<TurnRecord> => {
    // Step 12 runs for every outcome, including refusals: a turn nobody
    // recorded is a turn nobody can explain afterwards.
    await ports.observe(record);
    return record;
  };

  // Step 1. Before any work at all, so a provider retry costs nothing.
  if (!(await ports.isNewEvent(event))) {
    return finish({ ...base, outcome: "duplicate", reasonCodes: ["already_processed"] });
  }

  // Steps 2 and 3.
  const state = await ports.hydrate(event);

  // Step 4. Deliberately before understand(): a blocked turn must not reach a
  // model at all, for cost and because a blocked conversation should not be
  // read any further than necessary.
  const policy = await ports.evaluatePolicy(event);
  if (!policy.canSend) {
    return finish({
      ...base,
      outcome: "policy_blocked",
      reasonCodes: [policy.blockedReason ?? "policy_blocked"]
    });
  }

  // Steps 5, 6 and 7.
  const understanding = await ports.understand(event);
  const retrieved = await ports.retrieve(event, understanding);
  const decision = await ports.decide(event, understanding);

  // Step 8. A tool runs only if the safety classification permits it.
  let toolOutcome: ToolOutcome | undefined;
  if (decision.toolRequest) {
    const attempt: ActionAttempt = {
      actionClass: decision.toolRequest.actionClass,
      allowedActions: policy.allowedActions,
      actionName: decision.toolRequest.actionName,
      hasIdempotencyKey: Boolean(decision.toolRequest.idempotencyKey),
      hasHumanApproval: Boolean(decision.toolRequest.hasHumanApproval),
      hasAuthoritativeResult: false
    };
    const verdict = authorizeAction(attempt);
    if (!verdict.permitted) {
      return finish({
        ...base,
        outcome: "tool_refused",
        reasonCodes: [verdict.reason]
      });
    }
    toolOutcome = await ports.executeTool(decision.toolRequest);
  }

  // Step 9.
  const reply = await ports.compose(event, decision);

  // A completion may only be claimed where the class does not demand
  // confirmation, or where an authoritative result actually arrived.
  const claimPermitted = decision.toolRequest
    ? mayClaimSuccess({
        actionClass: decision.toolRequest.actionClass,
        allowedActions: policy.allowedActions,
        actionName: decision.toolRequest.actionName,
        hasIdempotencyKey: Boolean(decision.toolRequest.idempotencyKey),
        hasHumanApproval: Boolean(decision.toolRequest.hasHumanApproval),
        hasAuthoritativeResult: Boolean(toolOutcome?.authoritative)
      })
    : true;

  // Step 10.
  const sendRef = sendRefFor(event);
  const validation: ValidationContext = {
    availableRefs: retrieved.facts.map((fact) => fact.ref),
    approvedAmounts: retrieved.approvedAmounts,
    approvedTimes: retrieved.approvedTimes,
    hasAuthoritativeResult: Boolean(toolOutcome?.authoritative) && claimPermitted,
    claimsCompletion: reply.claimsCompletion,
    canSend: policy.canSend,
    alreadySentRefs: await ports.sentRefs(event),
    sendRef
  };
  const verdict = validateReply(reply, validation);

  const memory = applyMemoryWrites(decision.memoryWrites ?? [], state.facts);
  const counts = {
    acceptedMemoryWrites: memory.accepted.length,
    refusedMemoryWrites: memory.refused.length,
    toolExecuted: Boolean(toolOutcome)
  };

  // Before the commit, and before the validator's verdict is acted on: what the
  // customer told us is true whether or not the reply we drew from it passed.
  // A crash between here and the commit re-runs the whole turn, which proposes
  // the same facts against the same stored values and stores them again. The
  // other order cannot be repaired — the record would claim a fact that exists
  // nowhere, and nothing later can tell that from a fact since deleted.
  const persisted =
    memory.accepted.length === 0 ? 0 : await ports.persistFacts(event, memory.accepted);
  // The counts say what the policy accepted; this says whether it survived. A
  // turn that reports memory it does not have is the failure worth naming.
  const withMemoryNote = (codes: readonly string[]): readonly string[] =>
    persisted < memory.accepted.length ? [...codes, "memory_write_failed"] : codes;

  if (!verdict.allowed) {
    const resolution = safeResolution(verdict.failures);
    const record: TurnRecord = {
      ...base,
      ...counts,
      outcome: resolution.action === "handoff" ? "handoff" : "safe_acknowledgement",
      reasonCodes: withMemoryNote(verdict.failures)
    };
    // Still committed: a refused reply is part of the conversation's history
    // and the reason has to survive for whoever picks the handoff up.
    await ports.commit(record);
    return finish(record);
  }

  const record: TurnRecord = {
    ...base,
    ...counts,
    outcome: "sent",
    reasonCodes: withMemoryNote(decision.reasonCodes)
  };

  // Step 11: commit first, then send exactly once. The other order can produce
  // a message the system has no record of, which is unrecoverable — a duplicate
  // send is at least detectable.
  await ports.commit(record);
  await ports.send(reply, sendRef);
  return finish(record);
}
