/**
 * Which remembered facts a turn is allowed to overwrite.
 *
 * Customer memory is where an inference quietly becoming "truth" does lasting
 * damage: a model guesses a budget, writes it over something the customer
 * actually stated, and every later turn reasons from the guess. The rules from
 * the pack are that confirmed facts cannot be overwritten by weaker inference,
 * that a human edit is authoritative unless newer verified data supersedes it,
 * and that every fact carries source, confidence and freshness.
 *
 * Pure by design; no I/O.
 */

/** Ordered weakest to strongest. Order is the comparison. */
export const FACT_CONFIDENCES = [
  "inferred",
  "high_confidence",
  "confirmed",
  "human_verified"
] as const;

export type FactConfidence = (typeof FACT_CONFIDENCES)[number];

export type StoredFact = Readonly<{
  key: string;
  value: string;
  confidence: FactConfidence;
  /** Message or actor the fact came from; provenance is mandatory. */
  sourceRef: string;
  recordedAt: string;
  /** When the fact stops being trustworthy, if it ever does. */
  validUntil?: string | null;
}>;

export type ProposedFact = Readonly<{
  key: string;
  value: string;
  confidence: FactConfidence;
  sourceRef: string;
  recordedAt: string;
  validUntil?: string | null;
}>;

function strength(confidence: FactConfidence): number {
  return FACT_CONFIDENCES.indexOf(confidence);
}

/** Whether a fact has passed its validity window. */
export function hasExpired(fact: StoredFact, now: Date = new Date()): boolean {
  if (!fact.validUntil) return false;
  const until = new Date(fact.validUntil).getTime();
  return Number.isFinite(until) && until <= now.getTime();
}

export type WriteVerdict =
  | Readonly<{
      accepted: true;
      reason: "new" | "stronger" | "refreshed_equal" | "supersedes_expired";
    }>
  | Readonly<{ accepted: false; reason: string }>;

/**
 * Decides whether a proposed fact may replace what is already stored.
 *
 * An expired fact is treated as absent: stale data must not outrank a fresh
 * observation merely because it was once confirmed.
 */
export function authorizeMemoryWrite(
  proposed: ProposedFact,
  existing: StoredFact | undefined,
  now: Date = new Date()
): WriteVerdict {
  if (!proposed.sourceRef) {
    // Provenance is not optional: a fact nobody can trace cannot be audited,
    // corrected, or trusted later.
    return { accepted: false, reason: "missing provenance" };
  }

  if (!existing) return { accepted: true, reason: "new" };

  if (hasExpired(existing, now)) {
    return { accepted: true, reason: "supersedes_expired" };
  }

  const existingStrength = strength(existing.confidence);
  const proposedStrength = strength(proposed.confidence);

  if (proposedStrength > existingStrength) {
    return { accepted: true, reason: "stronger" };
  }

  if (proposedStrength < existingStrength) {
    return {
      accepted: false,
      reason: `weaker than stored ${existing.confidence}`
    };
  }

  // Equal strength: a newer observation of the same standing is allowed to
  // refresh the value, but an older one must not resurrect a stale answer.
  const proposedAt = new Date(proposed.recordedAt).getTime();
  const existingAt = new Date(existing.recordedAt).getTime();
  if (!Number.isFinite(proposedAt) || !Number.isFinite(existingAt)) {
    return { accepted: false, reason: "unusable timestamp" };
  }
  return proposedAt >= existingAt
    ? { accepted: true, reason: "refreshed_equal" }
    : { accepted: false, reason: "older than stored fact of equal confidence" };
}

/**
 * Applies a batch of proposed writes, returning what was kept and what was
 * refused with the reason. Refusals are surfaced rather than dropped so a
 * model repeatedly trying to overwrite confirmed facts is visible.
 */
export function applyMemoryWrites(
  proposals: readonly ProposedFact[],
  stored: readonly StoredFact[],
  now: Date = new Date()
): Readonly<{
  accepted: readonly ProposedFact[];
  refused: readonly Readonly<{ fact: ProposedFact; reason: string }>[];
}> {
  const index = new Map(stored.map((fact) => [fact.key, fact]));
  const accepted: ProposedFact[] = [];
  const refused: { fact: ProposedFact; reason: string }[] = [];

  for (const proposal of proposals) {
    const verdict = authorizeMemoryWrite(proposal, index.get(proposal.key), now);
    if (verdict.accepted) {
      accepted.push(proposal);
      // Later proposals in the same batch compare against this one, so a batch
      // cannot launder a weak write in behind a strong one.
      index.set(proposal.key, { ...proposal, validUntil: proposal.validUntil ?? null });
    } else {
      refused.push({ fact: proposal, reason: verdict.reason });
    }
  }

  return { accepted, refused };
}
