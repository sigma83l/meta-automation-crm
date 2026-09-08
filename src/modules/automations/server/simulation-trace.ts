import {
  sendRefFor,
  type ComposedReply,
  type TurnEvent,
  type TurnPolicy,
  type TurnPorts,
  type TurnRecord
} from "@/src/modules/rcos/turn-engine";
import { validateReply } from "@/src/modules/rcos/validator";
import {
  SIMULATION_STEPS,
  type SimulationStep,
  type SimulationStepId,
  type SimulationStepStatus,
  type SimulationSubjectKind,
  type SimulationTrace,
  type SimulationVerdict
} from "@/src/modules/automations/simulation-contracts";

/**
 * Turns a workspace's real turn ports into observed, side-effect-free ones.
 *
 * Kept separate from the wiring in `simulation.ts`, and taking the ports as an
 * argument rather than building them, because this is where the two guarantees
 * of a safe test actually live — every step is reported, and nothing is written
 * — and both need to be assertable without a database, a model or a workspace.
 *
 * The engine itself is untouched. `runTurn` calls these in its own order, so
 * what the trace shows is what the pipeline did, not what this file believes it
 * would do.
 */

export type InstrumentedPorts = Readonly<{
  ports: TurnPorts;
  /** All twelve steps, in engine order, including the ones never reached. */
  steps(): readonly SimulationStep[];
  draft(): SimulationTrace["draft"];
  /**
   * The validator's own words for why it refused, or undefined.
   *
   * `validateReply` returns a `detail` array naming the exact offending tokens
   * -- "times not confirmed by an authoritative source: Saturday" -- and the
   * engine keeps only the failure codes. Recovering it means running the same
   * pure function again over the same inputs, which is safe precisely because
   * it is pure, and is checked against the engine's own verdict before being
   * shown: a reconstruction that disagrees is withheld rather than trusted.
   */
  validationDetail(engineReasonCodes: readonly string[]): readonly string[] | undefined;
  /** What `send` was called with. Absent means nothing would go out. */
  wouldSend(): SimulationTrace["wouldSend"];
}>;

export function verdictFor(outcome: TurnRecord["outcome"]): SimulationVerdict {
  if (outcome === "sent") return "would_send";
  if (outcome === "handoff") return "would_hand_off";
  return "would_block";
}

export function instrumentPorts(
  real: TurnPorts,
  options: Readonly<{
    subject: SimulationSubjectKind;
    /**
     * Replaces step 4 entirely. Supplied only for `synthetic` runs, where the
     * real port would answer `conversation_missing` and stop the turn before
     * any later gate was exercised.
     */
    policy?: () => Promise<TurnPolicy>;
  }>
): InstrumentedPorts {
  const recorded = new Map<SimulationStepId, SimulationStep>();
  const note = (id: SimulationStepId, detail: string, status: SimulationStepStatus = "ran") => {
    const meta = SIMULATION_STEPS.find((entry) => entry.id === id);
    if (meta) recorded.set(id, { ...meta, status, detail });
  };

  let draft: SimulationTrace["draft"];
  let wouldSend: SimulationTrace["wouldSend"];
  // Everything `validateReply` needs, captured as the engine gathers it.
  let composed: ComposedReply | undefined;
  let policySeen: TurnPolicy | undefined;
  let retrievedSeen:
    | Readonly<{
        facts: readonly Readonly<{ ref: string }>[];
        approvedAmounts: readonly string[];
        approvedTimes: readonly string[];
      }>
    | undefined;
  let sentRefsSeen: readonly string[] = [];
  let eventSeen: TurnEvent | undefined;
  let toolRan = false;
  const fromConversation = options.subject === "conversation";
  // Step 3 is written twice — once when memory is read, once when the engine
  // would have stored what this turn learned. Keeping the first half means the
  // row says what was known *and* what would change, rather than the later
  // sentence silently replacing the earlier one.
  let memoryLoaded = "";

  const ports: TurnPorts = {
    ...real,
    async isNewEvent(turn) {
      const isNew = await real.isNewEvent(turn);
      note("idempotency", isNew ? "New event, not seen before." : "Already processed.");
      return isNew;
    },
    async hydrate(turn) {
      const state = await real.hydrate(turn);
      note(
        "hydrate",
        fromConversation
          ? "Loaded from the selected conversation."
          : "No prior conversation: a first contact."
      );
      memoryLoaded =
        state.facts.length === 0
          ? "No remembered facts for this contact."
          : `${state.facts.length} remembered fact${state.facts.length === 1 ? "" : "s"} loaded.`;
      note("memory", memoryLoaded);
      return state;
    },
    async evaluatePolicy(turn) {
      const policy = options.policy ? await options.policy() : await real.evaluatePolicy(turn);
      policySeen = policy;
      note(
        "policy",
        policy.canSend
          ? fromConversation
            ? "Open, not taken over, entitled. Replies permitted."
            : "Conversation stipulated open; entitlement and switches read live."
          : `Blocked: ${policy.blockedReason ?? "policy_blocked"}`,
        policy.canSend ? (fromConversation ? "ran" : "stipulated") : "blocked"
      );
      return policy;
    },
    async understand(turn) {
      const understanding = await real.understand(turn);
      const top = understanding.intents[0];
      note(
        "understand",
        top
          ? `Intent ${top.name} at ${Math.round(top.confidence * 100)}% confidence.`
          : "No intent identified."
      );
      return understanding;
    },
    async retrieve(turn, understanding) {
      const retrieved = await real.retrieve(turn, understanding);
      retrievedSeen = retrieved;
      note(
        "retrieve",
        `${retrieved.facts.length} approved fact(s), ${retrieved.approvedAmounts.length} approved price(s), ${retrieved.approvedTimes.length} approved time(s).`
      );
      return retrieved;
    },
    async decide(turn, understanding) {
      const decision = await real.decide(turn, understanding);
      note("decide", `${decision.type} at ${decision.priority}.`);
      return decision;
    },
    async executeTool(toolRequest) {
      const outcome = await real.executeTool(toolRequest);
      toolRan = true;
      note("tool", `${toolRequest.actionName} ran; authoritative: ${outcome.authoritative}.`);
      return outcome;
    },
    async compose(turn, decision) {
      const reply = await real.compose(turn, decision);
      // Captured here rather than at send time: the draft is worth showing even
      // when the validator later refuses it, and this is the only point at
      // which it exists before `commit` would have stored it.
      composed = reply;
      draft = { text: reply.text, citedRefs: reply.citedRefs };
      note("compose", reply.text ? "A reply was drafted." : "No reply text was produced.");
      return reply;
    },
    async sentRefs(turn) {
      const refs = await real.sentRefs(turn);
      sentRefsSeen = refs;
      eventSeen = turn;
      note("validate", "Reply checked against approved knowledge and prior sends.");
      return refs;
    },
    // The write ports, all neutralised. Each records what production would have
    // done and returns the value that keeps the engine on its real path.
    async persistFacts(_turn, facts) {
      // Returns the full count rather than 0: a short count makes the engine
      // append `memory_write_failed`, which would be a failure the simulation
      // invented rather than one the operator needs to see.
      const plural = facts.length === 1 ? "" : "s";
      note(
        "memory",
        `${memoryLoaded} ${facts.length} new fact${plural} would be stored. Nothing was written.`.trim()
      );
      return facts.length;
    },
    async commit(record) {
      note("commit", `Would commit outcome ${record.outcome}. Nothing was written.`);
    },
    async send(reply, sendRef) {
      wouldSend = { text: reply.text, sendRef };
      note("commit", "Would commit, then send exactly once. Nothing was sent.");
    },
    async observe() {
      note("observe", "Would record the turn for review. Nothing was written.");
    }
  };

  return {
    ports,
    steps: () =>
      SIMULATION_STEPS.map<SimulationStep>(
        (meta) => recorded.get(meta.id) ?? { ...meta, status: "skipped", detail: "Not reached." }
      ),
    draft: () => draft,
    wouldSend: () => wouldSend,
    validationDetail(engineReasonCodes) {
      // A tool changes `hasAuthoritativeResult`, and this reconstruction cannot
      // see the engine's copy of it. No tool ran means the value is knowably
      // false; otherwise decline rather than guess.
      if (toolRan || !composed || !policySeen || !retrievedSeen || !eventSeen) return undefined;
      const verdict = validateReply(
        { text: composed.text, citedRefs: composed.citedRefs },
        {
          availableRefs: retrievedSeen.facts.map((fact) => fact.ref),
          approvedAmounts: retrievedSeen.approvedAmounts,
          approvedTimes: retrievedSeen.approvedTimes,
          hasAuthoritativeResult: false,
          claimsCompletion: composed.claimsCompletion,
          canSend: policySeen.canSend,
          alreadySentRefs: sentRefsSeen,
          sendRef: sendRefFor(eventSeen)
        }
      );
      if (verdict.allowed) return undefined;
      // Only trusted when it reaches the same conclusion the engine did.
      const engine = [...engineReasonCodes].sort().join("|");
      const mine = [...verdict.failures].sort().join("|");
      return engine === mine ? verdict.detail : undefined;
    }
  };
}
