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
  /** Customer-facing sales, support and qualification. */
  "primary",
  /** Complex ambiguity or a high-value objection, only past a threshold. */
  "escalation",
  /** Golden sets and admin analysis. Never a customer reply. */
  "offline_evaluator"
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

/** Roles that may ever produce text a customer sees. */
const CUSTOMER_FACING: readonly ModelRole[] = ["deterministic", "primary", "escalation"];

export function mayAnswerCustomer(role: ModelRole): boolean {
  return CUSTOMER_FACING.includes(role);
}

export type RoutingTask =
  /** The answer is already known from a tool or an approved record. */
  | "known_value"
  | "intent_classification"
  | "language_detection"
  | "extraction"
  | "summarisation"
  | "customer_reply"
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

  if (
    task === "intent_classification" ||
    task === "language_detection" ||
    task === "extraction" ||
    task === "summarisation"
  ) {
    return "utility";
  }

  // Escalation is reserved, not a fallback for every uncertain turn: it is
  // slower and dearer, so it must be justified by stakes as well as doubt.
  if (signals.highStakes && signals.confidence < ESCALATION_CONFIDENCE_THRESHOLD) {
    return "escalation";
  }

  return "primary";
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
