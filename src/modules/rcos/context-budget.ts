/**
 * How much context a single turn is allowed to carry, and what gets dropped
 * when it does not fit.
 *
 * Two failures this prevents. The obvious one is cost: sending an entire
 * transcript on every turn is both expensive and, past a point, worse — the
 * decisive facts get buried. The subtler one is correctness: an unbounded
 * prompt has no defined behaviour when it overflows, so whatever the provider
 * truncates is arbitrary rather than chosen.
 *
 * Budgets come from the pack. Token counts are estimated, never authoritative:
 * the estimator is injectable so a provider's real tokenizer can replace the
 * heuristic without changing any of the rules here.
 */

export const CONTEXT_LAYERS = [
  "system_policy",
  "agent_snapshot",
  "customer_memory",
  "rolling_summary",
  "recent_turns",
  "retrieved_facts",
  "tool_state"
] as const;

export type ContextLayer = (typeof CONTEXT_LAYERS)[number];

export type LayerBudget = Readonly<{
  min: number;
  max: number;
  /**
   * Lower is dropped first. Authoritative and safety layers sit at the bottom
   * of the trim order because losing them changes what the model is allowed to
   * do, not merely how well it answers.
   */
  trimPriority: number;
  /** Layers that must never be trimmed, whatever the pressure. */
  essential: boolean;
}>;

export const LAYER_BUDGET: Readonly<Record<ContextLayer, LayerBudget>> = Object.freeze({
  // Hard policy defines what is permitted; dropping it would silently widen
  // the model's authority.
  system_policy: { min: 250, max: 400, trimPriority: 100, essential: true },
  // Authoritative status, availability, entitlement. Losing it is how a model
  // starts inventing the values it can no longer see.
  tool_state: { min: 80, max: 200, trimPriority: 90, essential: true },
  agent_snapshot: { min: 650, max: 1000, trimPriority: 70, essential: false },
  customer_memory: { min: 120, max: 250, trimPriority: 60, essential: false },
  retrieved_facts: { min: 250, max: 700, trimPriority: 40, essential: false },
  rolling_summary: { min: 120, max: 220, trimPriority: 30, essential: false },
  // Trimmed first: the summary already carries the thread, so older pairs are
  // the cheapest thing to lose.
  recent_turns: { min: 250, max: 600, trimPriority: 10, essential: false }
});

/** Normal ceiling for a turn. */
export const CONTEXT_TOTAL_TARGET = 2200;
/** Above this, the turn is anomalous and should be reported. */
export const CONTEXT_P95_ALERT = 3500;

/**
 * Rough token estimate. Deliberately crude and deliberately replaceable — the
 * budget rules must not depend on any provider's tokenizer.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export type LayerContent = Readonly<{ layer: ContextLayer; parts: readonly string[] }>;

export type CompiledLayer = Readonly<{
  layer: ContextLayer;
  parts: readonly string[];
  tokens: number;
  droppedParts: number;
}>;

export type CompiledContext = Readonly<{
  layers: readonly CompiledLayer[];
  totalTokens: number;
  withinTarget: boolean;
  /** True when the turn should be reported as anomalous. */
  exceedsAlertThreshold: boolean;
  trimmed: readonly ContextLayer[];
}>;

/**
 * Assembles a turn's context within budget.
 *
 * Each layer is first capped at its own maximum, then, if the total still
 * exceeds the target, whole layers are shed in trim-priority order. Essential
 * layers are never shed: if the result still does not fit, the caller is told
 * rather than silently handed an over-budget prompt.
 */
export function compileContext(
  content: readonly LayerContent[],
  estimate: (text: string) => number = estimateTokens
): CompiledContext {
  const byLayer = new Map<ContextLayer, string[]>();
  for (const entry of content) {
    byLayer.set(entry.layer, [...(byLayer.get(entry.layer) ?? []), ...entry.parts]);
  }

  const compiled: CompiledLayer[] = [];
  for (const layer of CONTEXT_LAYERS) {
    const parts = byLayer.get(layer) ?? [];
    if (!parts.length) continue;
    const budget = LAYER_BUDGET[layer];
    const kept: string[] = [];
    let tokens = 0;
    for (const part of parts) {
      const cost = estimate(part);
      if (tokens + cost > budget.max) break;
      kept.push(part);
      tokens += cost;
    }
    compiled.push({ layer, parts: kept, tokens, droppedParts: parts.length - kept.length });
  }

  const trimmed: ContextLayer[] = [];
  const shedOrder = [...compiled]
    .filter((entry) => !LAYER_BUDGET[entry.layer].essential)
    .sort((a, b) => LAYER_BUDGET[a.layer].trimPriority - LAYER_BUDGET[b.layer].trimPriority);

  let total = compiled.reduce((sum, entry) => sum + entry.tokens, 0);
  const removed = new Set<ContextLayer>();
  for (const candidate of shedOrder) {
    if (total <= CONTEXT_TOTAL_TARGET) break;
    total -= candidate.tokens;
    removed.add(candidate.layer);
    trimmed.push(candidate.layer);
  }

  const surviving = compiled.filter((entry) => !removed.has(entry.layer));
  const totalTokens = surviving.reduce((sum, entry) => sum + entry.tokens, 0);

  return {
    layers: surviving,
    totalTokens,
    withinTarget: totalTokens <= CONTEXT_TOTAL_TARGET,
    exceedsAlertThreshold: totalTokens > CONTEXT_P95_ALERT,
    trimmed
  };
}

/**
 * Whether a cached prefix is safe to reuse across customers.
 *
 * The agent snapshot is cached by hash and shared between turns, so anything
 * customer-specific inside it leaks from one conversation into another. This
 * checks the shape rather than the wording: a prefix carrying an address, a
 * phone number or a per-customer identifier is not cacheable, whatever it says.
 */
export function isCacheablePrefix(prefix: string): boolean {
  const customerShaped = [
    /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/, // email address
    /\+?\d[\d\s().-]{7,}\d/, // phone number
    /\bwamid\.[A-Za-z0-9_-]+/i, // provider message id
    /\bcustomer[_-]?id\b/i,
    /\bconversation[_-]?id\b/i
  ];
  return !customerShaped.some((pattern) => pattern.test(prefix));
}

/**
 * Guards the prohibition on sending a whole transcript.
 *
 * A turn should carry a few recent pairs, not the history. Exceeding the pair
 * budget is the signal that someone has started passing the conversation
 * wholesale.
 */
export const MAX_RECENT_TURN_PAIRS = 4;

export function withinTranscriptLimit(pairCount: number): boolean {
  return pairCount <= MAX_RECENT_TURN_PAIRS;
}
