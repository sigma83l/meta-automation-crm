import { appError, err, ok, type Result } from "@/src/lib/result";

/**
 * Which class of model, if any, handles a given task.
 *
 * The router decides a *role*; it never names a model. Identifiers live in
 * configuration, so a provider deprecation is an environment change rather than
 * a code change — and a model cannot be swapped in a hot path by editing a
 * constant nobody reviews. A test asserts this file contains no identifier.
 *
 * The cheapest capable role wins. That is a cost argument, but mostly a
 * correctness one: a value the system already knows should be read, not
 * generated, because generating it is the step that can get it wrong.
 */

export const MODEL_ROLES = [
  /** No model at all: opt-out, opening hours, values a tool already returned. */
  "deterministic",
  /** Small model: intent, language, extraction, summarising, simple rewrite. */
  "utility",
  /**
   * Customer-facing, but only for reading one approved answer back.
   *
   * Separate from `utility` rather than reusing it, because `utility` is
   * schema-constrained extraction that may never be shown to a customer and
   * that rule is worth keeping. This role may be shown to a customer; what
   * restricts it is the *turn*, not the wording, and `selectReplyModel` owns
   * that restriction.
   */
  "lookup",
  /** Customer-facing sales, support and qualification. */
  "primary",
  /** Complex ambiguity or a high-value objection, only past a threshold. */
  "escalation",
  /** Golden sets and admin analysis. Never a customer reply. */
  "offline_evaluator"
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

/** Roles that may ever produce text a customer sees. */
const CUSTOMER_FACING: readonly ModelRole[] = ["deterministic", "lookup", "primary", "escalation"];

export function mayAnswerCustomer(role: ModelRole): boolean {
  return CUSTOMER_FACING.includes(role);
}

/**
 * The tasks that are not a customer reply.
 *
 * `customer_reply` used to be one of these and is not any more. Choosing the
 * model that writes to a customer needs signals none of the others need - what
 * retrieval offered, how long the conversation is, what the workspace's own
 * confidence threshold is, how earlier turns ended - and `selectReplyModel`
 * owns that. Leaving a `customer_reply` branch here as well would be two
 * answers to one question, and the one with less to go on would win by being
 * called first.
 */
export type RoutingTask =
  /** The answer is already known from a tool or an approved record. */
  | "known_value"
  | "intent_classification"
  | "language_detection"
  | "extraction"
  | "summarisation"
  | "golden_set_evaluation";

export type RoutingSignals = Readonly<{
  /** Confidence in the understanding this turn is built on. */
  confidence: number;
  /** Whether the turn involves a high-value objection or genuine ambiguity. */
  highStakes: boolean;
  /** Whether an authoritative source already supplies the answer. */
  answerIsKnown: boolean;
}>;

/** Below this, a customer reply is not left to the primary model alone. */
export const ESCALATION_CONFIDENCE_THRESHOLD = 0.55;

export function selectRole(task: RoutingTask, signals: RoutingSignals): ModelRole {
  if (task === "golden_set_evaluation") return "offline_evaluator";

  // Prefer no model wherever the answer is already established. This is the
  // single largest source of both cost and invented facts.
  if (task === "known_value" || signals.answerIsKnown) return "deterministic";

  return "utility";
}

/**
 * What a reply-routing decision may know.
 *
 * Everything here is already computed by the time `compose` runs: the
 * classifier produced the first three, the workspace's profile the fourth,
 * retrieval the fifth, and the assembled context the last two. Nothing is
 * inferred from the customer's words, which is deliberate - a router that read
 * the message would be a second, unreviewed classifier.
 */
export type ReplyRoutingSignals = Readonly<{
  /** The classifier's confidence in what the customer wants. */
  confidence: number;
  highStakes: boolean;
  /** An authoritative source already supplies the answer. */
  answerIsKnown: boolean;
  /** The workspace's own `low_confidence_threshold`. */
  lowConfidenceThreshold: number;
  /** Approved FAQ and price items retrieval offered this turn. */
  approvedItemsOffered: number;
  /** Estimated tokens the model will read. See `context-budget`. */
  contextTokens: number;
  /** Customer messages in the transcript this turn carries. */
  customerMessages: number;
  /** An earlier turn in this conversation already needed a person. */
  priorHandoff: boolean;
}>;

export type ReplyRouting = Readonly<{
  role: ModelRole;
  /**
   * Why, in the order decided. Machine-readable and surfaced in the Test
   * Center: a cost optimisation nobody can see the reasoning of is one nobody
   * can argue with when it answers a customer badly.
   */
  reasons: readonly string[];
}>;

/**
 * Below this the cheap model does not write a customer reply, whatever the
 * workspace's own threshold says.
 *
 * Measured: across the eight golden cases the classifier reported 0.90, 0.95,
 * 0.95, 0.95, 0.98, 0.99, 0.99 and 1.00 - it is confident about *what is being
 * asked* even on the cases where nothing approved can answer it. So confidence
 * is a weak signal here and this floor is a veto, not the decision. It sits at
 * 0.80: clear of every value observed, so ordinary variation does not bounce a
 * turn to the dearer model, and still high enough that a genuinely confused
 * classification never reaches the cheap path.
 */
export const LOOKUP_CONFIDENCE_FLOOR = 0.8;

/**
 * How many approved items may be in front of the cheap model.
 *
 * This is the measurement, not a round number. The golden fixture offers six
 * approved items - three FAQ answers and three prices - and on that set the
 * small non-thinking model answered all eight cases correctly: it cited the
 * right FAQ, quoted the right price, and asked for a person on all six cases
 * that should reach one. Six is what was measured, so six is the bound. Raise
 * it when a larger set has been measured, not before: past some size choosing
 * between approved items stops being a lookup and becomes the selection
 * problem the dearer model is for.
 */
export const LOOKUP_MAX_APPROVED_ITEMS = 6;

/**
 * How much context the cheap path may carry.
 *
 * The measured reply prompt for the six-item fixture was 850 input tokens.
 * 1200 leaves room for a couple more transcript turns and stays well below
 * `CONTEXT_TOTAL_TARGET`, the point at which the budget starts shedding whole
 * layers - a turn being trimmed is by definition not a simple one.
 */
export const LOOKUP_MAX_CONTEXT_TOKENS = 1200;

/**
 * How long a conversation may be and still count as a direct question.
 *
 * Unlike the two above, this one is a judgement rather than a measurement: a
 * third customer message is usually contextual ("and the other one?"), which
 * is reasoning rather than reading. Said plainly because a threshold nobody
 * can tell from a measured one is a threshold nobody will revisit.
 */
export const LOOKUP_MAX_CUSTOMER_MESSAGES = 2;

/**
 * Picks the cheapest model that can answer *this* turn.
 *
 * Cheapest-first with named escapes, and every escape returns the dearer
 * model rather than a cheaper one, so a signal this cannot read can only make
 * the choice more conservative. That is the whole safety argument: the failure
 * mode of a missing input here is spending too much, never answering badly.
 *
 * `reasons` is returned rather than logged because the choice has to be
 * defensible after the fact. The Test Center shows it.
 */
export function selectReplyModel(signals: ReplyRoutingSignals): ReplyRouting {
  if (signals.answerIsKnown) {
    return { role: "deterministic", reasons: ["answer_already_known"] };
  }

  // Stakes first, and before any cost consideration. A complaint, a refund or
  // a safety matter is not a turn to economise on, and a doubtful reading of
  // one is the only thing that justifies the dearest model.
  if (signals.highStakes) {
    return signals.confidence < ESCALATION_CONFIDENCE_THRESHOLD
      ? { role: "escalation", reasons: ["high_stakes", "confidence_below_escalation_threshold"] }
      : { role: "primary", reasons: ["high_stakes"] };
  }

  // The reasons a lookup is not a lookup, gathered rather than returned one at
  // a time: an operator reading "we used the dearer model" wants all of why,
  // not whichever check happened to be written first.
  const blockers: string[] = [];
  if (signals.priorHandoff) blockers.push("prior_turn_needed_a_person");
  if (signals.confidence < Math.max(signals.lowConfidenceThreshold, LOOKUP_CONFIDENCE_FLOOR)) {
    blockers.push("confidence_below_lookup_floor");
  }
  // Nothing approved is where invention risk is highest, and it is also the
  // turn most likely to end at a person. Neither is worth economising on.
  if (signals.approvedItemsOffered === 0) blockers.push("nothing_approved_to_read");
  if (signals.approvedItemsOffered > LOOKUP_MAX_APPROVED_ITEMS) {
    blockers.push("too_many_approved_items_to_choose_between");
  }
  if (signals.contextTokens > LOOKUP_MAX_CONTEXT_TOKENS) blockers.push("context_too_large");
  if (signals.customerMessages > LOOKUP_MAX_CUSTOMER_MESSAGES) {
    blockers.push("conversation_too_long_to_be_a_direct_question");
  }

  return blockers.length > 0
    ? { role: "primary", reasons: blockers }
    : { role: "lookup", reasons: ["direct_lookup_against_approved_knowledge"] };
}

/**
 * The model a role actually runs on.
 *
 * `lookup` is the one role permitted a substitute, and only upwards. An
 * unconfigured `lookup` falls back to `primary`, which is the more capable
 * model: the fallback can cost more but can never answer worse, and the
 * alternative - `resolveModel` failing, an empty draft, a handoff - would turn
 * "this deployment has not set one more environment variable" into a customer
 * who never got a reply. Every other role still fails loudly, because for them
 * a substitute changes what the model is allowed to do rather than only what
 * it costs.
 */
export function resolveReplyModel(role: ModelRole, registry: ModelRegistry): Result<string> {
  if (role === "lookup" && !registry.lookup) return resolveModel("primary", registry);
  return resolveModel(role, registry);
}

/**
 * How many generative calls a turn may make.
 *
 * One is the norm. A second pass is permitted only where the first is genuinely
 * unreliable — low confidence on a high-stakes turn — because an unbounded
 * retry loop is how a single conversation quietly costs more than a customer.
 */
export function generativeCallBudget(role: ModelRole, signals: RoutingSignals): number {
  if (role === "deterministic") return 0;
  const needsSecondPass =
    signals.highStakes && signals.confidence < ESCALATION_CONFIDENCE_THRESHOLD;
  return needsSecondPass ? 2 : 1;
}

export type ModelRegistry = Readonly<Partial<Record<ModelRole, string>>>;

/**
 * Resolves a role to a configured identifier.
 *
 * Fails rather than substituting a default. A silent fallback to some other
 * model would change behaviour, cost and safety characteristics without anyone
 * noticing, which is worse than a loud misconfiguration at startup.
 */
export function resolveModel(role: ModelRole, registry: ModelRegistry): Result<string> {
  const configured = registry[role];
  if (!configured) {
    return err(
      appError("CONFIGURATION_MISSING", `No model configured for the ${role} role.`, {
        details: { role }
      })
    );
  }
  return ok(configured);
}

/**
 * Narrows the tool list to what an intent could plausibly need.
 *
 * Every additional tool is both prompt budget and surface area: a model cannot
 * misuse a tool it was never offered.
 */
export function toolsForIntent(
  intent: string,
  catalogue: Readonly<Record<string, readonly string[]>>,
  fallback: readonly string[] = []
): readonly string[] {
  return catalogue[intent] ?? fallback;
}
