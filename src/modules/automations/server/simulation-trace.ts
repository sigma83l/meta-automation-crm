import type { TurnPolicy, TurnPorts, TurnRecord } from "@/src/modules/rcos/turn-engine";
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
      note("tool", `${toolRequest.actionName} ran; authoritative: ${outcome.authoritative}.`);
      return outcome;
    },
    async compose(turn, decision) {
      const reply = await real.compose(turn, decision);
      // Captured here rather than at send time: the draft is worth showing even
      // when the validator later refuses it, and this is the only point at
      // which it exists before `commit` would have stored it.
      draft = { text: reply.text, citedRefs: reply.citedRefs };
      note("compose", reply.text ? "A reply was drafted." : "No reply text was produced.");
      return reply;
    },
    async sentRefs(turn) {
      const refs = await real.sentRefs(turn);
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
    wouldSend: () => wouldSend
  };
}
