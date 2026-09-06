/**
 * Turning evidence into a score that can be argued with.
 *
 * `scoreFromEvidence` in revenue-state.ts produces a number and nothing else:
 * one confidence-discounted sum, no components, no version, no record of what
 * it rested on. It is unit tested and called by nothing, and it cannot answer
 * either of the two questions anybody actually asks a score - why is it this
 * number, and why did it change. This replaces it.
 *
 * Three rules from `backend/03_SCORE_CONTRACT.md` and the golden matrix shape
 * everything here:
 *
 *   Every non-zero contribution names its evidence. Evidence that cannot say
 *   where it came from contributes zero - not a default, not a guess.
 *
 *   The same evidence and the same config always produce the same score. That
 *   is what makes a stored snapshot worth keeping and a disagreement
 *   resolvable.
 *
 *   The AI extracts evidence; it does not produce the score. Nothing in this
 *   file takes a model's word for a number.
 *
 * Pure by design; the tables backing it are in the score engine migration.
 */

/**
 * The eight scored areas. Their default caps sum to exactly 100, which is why
 * the contract's "normalise to 0-100" needs no scaling factor: a perfectly
 * evidenced contact reaches 100 by arithmetic rather than by division.
 */
export const SCORE_COMPONENTS = [
  "intent",
  "fit",
  "need_pain",
  "urgency",
  "financial_fit",
  "commitment",
  "engagement",
  "data_confidence"
] as const;
export type ScoreComponent = (typeof SCORE_COMPONENTS)[number];

/** What a piece of evidence can be about. Disqualifiers subtract; nothing else does. */
export const EVIDENCE_COMPONENTS = [...SCORE_COMPONENTS, "disqualifier"] as const;
export type EvidenceComponent = (typeof EVIDENCE_COMPONENTS)[number];

export type ScoreConfidence = "inferred" | "high_confidence" | "confirmed" | "human_verified";

/**
 * Confidence as whole percentages, not fractions.
 *
 * Integer arithmetic is the reason. Float addition is not associative, so a
 * score summed over the same evidence in a different row order could differ in
 * the last place - and "deterministic" is the property this engine is sold on.
 * Rounding each contribution to an integer first makes the sum exact and the
 * row order irrelevant.
 *
 * `confirmed` and `human_verified` are both 100 deliberately. They rank
 * differently when deciding which of two facts wins, which is what the memory
 * policy uses the ladder for; neither is discounted once it is believed.
 */
const CONFIDENCE_PERCENT: Readonly<Record<ScoreConfidence, number>> = {
  inferred: 40,
  high_confidence: 70,
  confirmed: 100,
  human_verified: 100
};

export type ScoreConfig = Readonly<{
  /** Immutable once stored. Changing a weight means a new version. */
  version: string;
  components: Readonly<Record<ScoreComponent, number>>;
  /** The furthest disqualifiers may pull a score down. Zero or negative. */
  disqualifierMin: number;
}>;

/** The pack's `CRM_SCORE_CONFIG_V1`, unchanged. */
export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  version: "crm-score-v1",
  components: {
    intent: 25,
    fit: 20,
    need_pain: 15,
    urgency: 10,
    financial_fit: 10,
    commitment: 10,
    engagement: 5,
    data_confidence: 5
  },
  disqualifierMin: -100
};

export type ScoredEvidence = Readonly<{
  component: EvidenceComponent;
  /** -100..100. What this observation is worth before confidence is applied. */
  weight: number;
  confidence: ScoreConfidence;
  /** The message, note or actor this came from. Without it, it counts for nothing. */
  evidenceRef: string | null;
  /** When this stops being true, if it ever does. */
  expiresAt?: string | null;
}>;

export type ScoreDriver = Readonly<{ component: ScoreComponent; contribution: number }>;

export type ScoreBlocker = Readonly<{
  component: EvidenceComponent;
  reason: "disqualified" | "unevidenced";
  /** Points this is costing: the penalty applied, or the cap not earned. */
  cost: number;
}>;

export type ScoreSnapshot = Readonly<{
  score: number;
  components: Readonly<Record<ScoreComponent, number>>;
  disqualifierPenalty: number;
  /** 0..1: how strong the evidence behind this score is, on average. */
  confidence: number;
  topDrivers: readonly ScoreDriver[];
  topBlockers: readonly ScoreBlocker[];
  configVersion: string;
  /** Every ref that contributed, deduplicated and ordered. */
  evidenceRefs: readonly string[];
  reasonCodes: readonly string[];
}>;

export type ConfigVerdict = Readonly<{ valid: true }> | Readonly<{ valid: false; reason: string }>;

/**
 * Whether a workspace's weights are usable.
 *
 * The caps must total exactly 100. The pack allows a workspace to customise
 * them and calls the customisation bounded, and this is the bound that matters:
 * if they total less, nobody can reach 100 and the number stops meaning what it
 * says; if they total more, the final clamp does the normalising and two
 * workspaces' scores stop being comparable.
 */
export function validateScoreConfig(config: ScoreConfig): ConfigVerdict {
  if (!config.version.trim()) return { valid: false, reason: "a config needs a version" };

  let total = 0;
  for (const component of SCORE_COMPONENTS) {
    const cap = config.components[component];
    if (!Number.isInteger(cap) || cap < 0 || cap > 100) {
      return { valid: false, reason: `${component} needs a whole cap between 0 and 100` };
    }
    total += cap;
  }
  if (total !== 100) {
    return { valid: false, reason: `component caps must total 100, not ${total}` };
  }

  if (
    !Number.isInteger(config.disqualifierMin) ||
    config.disqualifierMin > 0 ||
    config.disqualifierMin < -100
  ) {
    return { valid: false, reason: "disqualifierMin must be a whole number between -100 and 0" };
  }
  return { valid: true };
}

/** Whether this evidence may contribute at all, as of `now`. */
export function counts(evidence: ScoredEvidence, now: Date): boolean {
  // The rule with teeth: a contribution nobody can trace is not a weaker
  // contribution, it is no contribution.
  if (!evidence.evidenceRef?.trim()) return false;
  if (!evidence.expiresAt) return true;
  const expiry = Date.parse(evidence.expiresAt);
  // An unparseable expiry is treated as expired. The alternative is letting a
  // malformed date grant a fact permanent life, which is the wrong way to fail.
  if (Number.isNaN(expiry)) return false;
  return expiry > now.getTime();
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/**
 * Scores one contact.
 *
 * `now` is a parameter rather than read here so that a recalculation is
 * reproducible: replaying the same evidence at the same instant must give the
 * same answer, and expiry is the only thing in this function that time touches.
 */
export function computeScore(
  evidence: readonly ScoredEvidence[],
  config: ScoreConfig = DEFAULT_SCORE_CONFIG,
  now: Date = new Date()
): ScoreSnapshot {
  const counting = evidence.filter((item) => counts(item, now));

  const raw = new Map<EvidenceComponent, number>();
  // Magnitude-weighted confidence, so the reported confidence reflects the
  // evidence that actually moved the score rather than the count of rows.
  let weighted = 0;
  let magnitude = 0;

  for (const item of counting) {
    const percent = CONFIDENCE_PERCENT[item.confidence];
    const contribution = Math.round((item.weight * percent) / 100);
    raw.set(item.component, (raw.get(item.component) ?? 0) + contribution);
    weighted += Math.abs(item.weight) * percent;
    magnitude += Math.abs(item.weight) * 100;
  }

  const components = {} as Record<ScoreComponent, number>;
  let positive = 0;
  for (const component of SCORE_COMPONENTS) {
    // A component floors at zero: negative evidence within an area can cancel
    // that area out and no more. Pulling the total down is what a disqualifier
    // is for, and keeping the two separate stops "not a great fit" from being
    // silently promoted into "do not pursue".
    const value = clamp(raw.get(component) ?? 0, 0, config.components[component]);
    components[component] = value;
    positive += value;
  }

  // Clamped to at most zero: a disqualifier may never raise a score, whatever
  // sign somebody recorded it with.
  const disqualifierPenalty = clamp(raw.get("disqualifier") ?? 0, config.disqualifierMin, 0);
  const score = clamp(positive + disqualifierPenalty, 0, 100);

  const topDrivers = SCORE_COMPONENTS.filter((component) => components[component] > 0)
    .map((component) => ({ component, contribution: components[component] }))
    // Component order breaks ties, so two equal drivers always sort the same
    // way and a snapshot is byte-comparable with its recomputation.
    .sort((a, b) => b.contribution - a.contribution || a.component.localeCompare(b.component))
    .slice(0, 3);

  const blockers: ScoreBlocker[] = [];
  if (disqualifierPenalty < 0) {
    blockers.push({
      component: "disqualifier",
      reason: "disqualified",
      cost: Math.abs(disqualifierPenalty)
    });
  }
  for (const component of SCORE_COMPONENTS) {
    // The points this contact has not earned. An unevidenced area is the most
    // actionable thing a score can say - it names the question still worth
    // asking - so it is reported rather than left as a silent zero.
    if (components[component] === 0 && config.components[component] > 0) {
      blockers.push({
        component,
        reason: "unevidenced",
        cost: config.components[component]
      });
    }
  }
  const topBlockers = blockers
    .sort((a, b) => b.cost - a.cost || a.component.localeCompare(b.component))
    .slice(0, 3);

  const evidenceRefs = [...new Set(counting.map((item) => item.evidenceRef!.trim()))].sort();

  const reasonCodes: string[] = [];
  if (!counting.length) reasonCodes.push("no_evidence");
  if (counting.length < evidence.length) reasonCodes.push("evidence_discounted");
  if (disqualifierPenalty < 0) reasonCodes.push("disqualified");

  return {
    score,
    components,
    disqualifierPenalty,
    // Two decimals, so a stored snapshot and a fresh recomputation compare
    // equal rather than differing somewhere past the point anybody reads.
    confidence: magnitude === 0 ? 0 : Math.round((weighted / magnitude) * 100) / 100,
    topDrivers,
    topBlockers,
    configVersion: config.version,
    evidenceRefs,
    reasonCodes
  };
}
