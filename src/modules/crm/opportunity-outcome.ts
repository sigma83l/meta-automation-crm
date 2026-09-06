/**
 * Who may declare that a deal was won.
 *
 * The pack's hard-fail list names "AI fabricates booking/payment/outcome", and
 * `CRM_LIFECYCLE_V1` puts the reason plainly: positive customer words never
 * equal verified conversion. A model reading "great, I'll take it" has seen
 * enthusiasm, not a payment - and once an opportunity is marked won, every
 * report downstream treats it as revenue that happened.
 *
 * So the rule is about provenance rather than confidence. No amount of
 * certainty promotes an inference into an outcome; only a person or an
 * authoritative provider result can, and each has to say what it is going on.
 *
 * Pure by design; the columns backing this are in the CRM migration.
 */

export const OUTCOME_SOURCES = ["human", "ai", "automation", "provider", "system"] as const;
export type OutcomeSource = (typeof OUTCOME_SOURCES)[number];

/**
 * Sources permitted to declare a win.
 *
 * A person, because somebody is accountable for the claim. A provider, because
 * a payment or booking confirmation is an authoritative result rather than a
 * reading of one. Deliberately not `automation` or `system`: both are this
 * software declaring its own success, which is the same problem as `ai` wearing
 * a different name.
 */
export const WIN_SOURCES: readonly OutcomeSource[] = ["human", "provider"];

export const OPPORTUNITY_STAGES = ["open", "proposed", "won", "lost"] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export type OutcomeClaim = Readonly<{
  stage: OpportunityStage;
  source: OutcomeSource;
  /** The payment, booking or message the claim rests on. */
  evidenceRef?: string | null;
  /** Why it was lost. Required for a loss; a loss nobody explained teaches nothing. */
  lostReason?: string | null;
}>;

export type OutcomeVerdict =
  Readonly<{ allowed: true }> | Readonly<{ allowed: false; reason: string }>;

/** Whether this claim may be recorded as the opportunity's outcome. */
export function authorizeOutcome(claim: OutcomeClaim): OutcomeVerdict {
  if (claim.stage === "open" || claim.stage === "proposed") {
    // Not an outcome. Moving back to open is how a premature close is undone,
    // and requiring evidence to un-declare something would trap the mistake.
    return { allowed: true };
  }

  if (claim.stage === "won") {
    if (!WIN_SOURCES.includes(claim.source)) {
      return { allowed: false, reason: `${claim.source} may not declare a win` };
    }
    if (!claim.evidenceRef?.trim()) {
      // The win itself has to point at something. "A human said so" is a
      // source; "a human said so, here" is a source and a record.
      return { allowed: false, reason: "a win must cite what it rests on" };
    }
    return { allowed: true };
  }

  // Lost. Any source may observe a loss - a customer saying no, a provider
  // reporting a failed payment, a follow-up budget running out are all real -
  // but the reason is what makes a pipeline of losses worth reading.
  if (!claim.lostReason?.trim()) {
    return { allowed: false, reason: "a loss must say why" };
  }
  return { allowed: true };
}
