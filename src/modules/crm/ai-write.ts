/**
 * What a model is allowed to say about a customer, and what happens to it.
 *
 * `10_AI_CRM_WRITE_ENGINE.md` ends with the rule the whole file exists to
 * enforce: the AI never executes SQL or an update by field name, it emits a
 * strict application-owned proposal. So a proposal here is a closed shape -
 * facts under keys, evidence under the eight scored components, values for
 * fields the workspace has defined and marked model-writable, and a lifecycle
 * stage from the fixed vocabulary. There is nowhere in this type to put a
 * column name, a table, a path or an operator, which is what makes the rule
 * structural rather than a promise in a prompt.
 *
 * Every candidate is then classified rather than accepted: `confirmed`,
 * `inferred`, `conflicted` or `rejected`, which is the pack's step 8. The
 * rules doing the classifying are the ones that already exist - the memory
 * policy decides what may overwrite what, the custom field policy decides what
 * a model may write at all - because a second set of rules here would be a
 * second answer to "may this be written", and the two would drift.
 *
 * `commit` is separate from the verdict because there is a fifth state the four
 * names cannot express: a field whose permission is `suggest` produces a real,
 * well-formed inference that a person still has to accept. Calling that
 * `rejected` would be a lie about the value and `confirmed` a lie about its
 * standing, so it is an inference that is not committed.
 *
 * Pure by design; no I/O.
 */

import {
  authorizeFieldWrite,
  type FieldConfidence,
  type FieldDefinition,
  type FieldType,
  type FieldWriter
} from "./custom-field-policy";
import { EVIDENCE_COMPONENTS, type EvidenceComponent } from "./qualification-score";
import { LIFECYCLE_STAGES, type LifecycleStage } from "./revenue-state";
import {
  authorizeMemoryWrite,
  type FactConfidence,
  type ProposedFact,
  type StoredFact
} from "@/src/modules/rcos/memory-policy";

/** A fact the model wants remembered, in the memory policy's own shape. */
export type ProposedMemory = ProposedFact;

/**
 * Evidence for one scored component.
 *
 * `evidenceRef` is required and not optional-with-a-default: the score engine's
 * whole claim is that a number can be traced to what produced it, and a model
 * is the last writer that should be trusted with an untraceable one.
 */
export type ProposedEvidence = Readonly<{
  signal: string;
  component: EvidenceComponent;
  weight: number;
  confidence: FactConfidence;
  evidenceRef: string;
}>;

export type ProposedFieldValue = Readonly<{
  fieldKey: string;
  value: string | number | boolean;
  sourceRef: string;
  /** Whether an authoritative system - not the conversation - produced this. */
  authoritative?: boolean;
}>;

export type ProposedTransition = Readonly<{
  to: LifecycleStage;
  reasonCodes: readonly string[];
  evidenceRef?: string;
}>;

/**
 * One model's proposal about one customer.
 *
 * Nothing in here names a column, and every list is closed by a vocabulary this
 * repository owns.
 */
export type AiCrmProposal = Readonly<{
  facts?: readonly ProposedMemory[];
  evidence?: readonly ProposedEvidence[];
  fieldValues?: readonly ProposedFieldValue[];
  transition?: ProposedTransition;
}>;

export const WRITE_CLASSES = ["confirmed", "inferred", "conflicted", "rejected"] as const;
export type WriteClass = (typeof WRITE_CLASSES)[number];

export type Classified<T> = Readonly<{
  candidate: T;
  verdict: WriteClass;
  reason: string;
  /** Whether this will actually be written. False for everything unaccepted. */
  commit: boolean;
}>;

export type ClassifiedProposal = Readonly<{
  facts: readonly Classified<ProposedMemory>[];
  evidence: readonly Classified<ProposedEvidence>[];
  fieldValues: readonly Classified<
    ProposedFieldValue & { writer: FieldWriter; confidence?: FieldConfidence }
  >[];
  transition: Classified<ProposedTransition> | null;
}>;

export type CurrentCrmState = Readonly<{
  facts: readonly StoredFact[];
  /** Every evidence reference already on file, as `component|ref`. */
  evidenceKeys: ReadonlySet<string>;
  definitions: readonly (FieldDefinition & { fieldType: FieldType })[];
  lifecycleStage: LifecycleStage;
}>;

/**
 * The unique key `contact_facts` upserts on, named once.
 *
 * Two writers reach that table - this module's commit path and the turn's
 * `persistFacts` - and getting the conflict target wrong means a second row for
 * a key that is supposed to have one, which is how a customer ends up with two
 * budgets. Naming it here is what stops the two from drifting apart.
 */
export const CONTACT_FACTS_CONFLICT = "workspace_id,customer_id,fact_key";

/** How an evidence row is identified for the freshness check. */
export const evidenceKey = (component: string, ref: string) => `${component}|${ref}`;

/**
 * A confidence strong enough to call the write confirmed rather than inferred.
 *
 * The line is the customer's own words or a person's: everything below it is
 * the model's reading of them, however sure it sounds.
 */
const isConfirmed = (confidence: FactConfidence) =>
  confidence === "confirmed" || confidence === "human_verified";

/** A refusal about strength or freshness is a conflict; anything else is a refusal. */
const conflicted = (reason: string) => /weaker|stronger|newer|older|expired|human/i.test(reason);

export function classifyProposal(
  proposal: AiCrmProposal,
  current: CurrentCrmState,
  now: Date = new Date()
): ClassifiedProposal {
  const facts: Classified<ProposedMemory>[] = [];
  // Later candidates compare against earlier accepted ones, so a batch cannot
  // launder a weak write in behind a strong one - the same reason
  // `applyMemoryWrites` keeps a running index.
  const index = new Map(current.facts.map((fact) => [fact.key, fact]));

  for (const candidate of proposal.facts ?? []) {
    const verdict = authorizeMemoryWrite(candidate, index.get(candidate.key), now);
    if (verdict.accepted) {
      index.set(candidate.key, { ...candidate, validUntil: candidate.validUntil ?? null });
      facts.push({
        candidate,
        verdict: isConfirmed(candidate.confidence) ? "confirmed" : "inferred",
        reason: verdict.reason,
        commit: true
      });
      continue;
    }
    facts.push({
      candidate,
      verdict: conflicted(verdict.reason) ? "conflicted" : "rejected",
      reason: verdict.reason,
      commit: false
    });
  }

  const seen = new Set(current.evidenceKeys);
  const evidence = (proposal.evidence ?? []).map((candidate): Classified<ProposedEvidence> => {
    if (!EVIDENCE_COMPONENTS.includes(candidate.component)) {
      return {
        candidate,
        verdict: "rejected",
        reason: "component outside the contract",
        commit: false
      };
    }
    if (!candidate.evidenceRef.trim()) {
      return { candidate, verdict: "rejected", reason: "missing provenance", commit: false };
    }
    const key = evidenceKey(candidate.component, candidate.evidenceRef);
    if (seen.has(key)) {
      // The same observation offered twice. Storing it again would raise a
      // score for one thing that happened, which is how a re-processed
      // conversation quietly qualifies a lead.
      return { candidate, verdict: "rejected", reason: "already recorded", commit: false };
    }
    seen.add(key);
    return {
      candidate,
      verdict: isConfirmed(candidate.confidence) ? "confirmed" : "inferred",
      reason: "new",
      commit: true
    };
  });

  const byKey = new Map(current.definitions.map((definition) => [definition.fieldKey, definition]));
  const fieldValues = (proposal.fieldValues ?? []).map(
    (
      candidate
    ): Classified<ProposedFieldValue & { writer: FieldWriter; confidence?: FieldConfidence }> => {
      const withWriter = { ...candidate, writer: "ai" as const };
      const definition = byKey.get(candidate.fieldKey);
      if (!definition) {
        // Not a field this workspace defined. The model may only write into a
        // vocabulary somebody declared, which is the difference between a
        // custom field and an arbitrary column.
        return {
          candidate: withWriter,
          verdict: "rejected",
          reason: "no such field",
          commit: false
        };
      }
      const verdict = authorizeFieldWrite(definition, {
        value: candidate.value,
        writer: "ai",
        sourceRef: candidate.sourceRef,
        ...(candidate.authoritative === undefined ? {} : { authoritative: candidate.authoritative })
      });
      if (verdict.outcome === "store") {
        return {
          candidate: { ...withWriter, confidence: verdict.confidence },
          verdict: verdict.confidence === "confirmed" ? "confirmed" : "inferred",
          reason: "permitted",
          commit: true
        };
      }
      if (verdict.outcome === "suggest") {
        return {
          candidate: withWriter,
          verdict: "inferred",
          reason: verdict.reason,
          commit: false
        };
      }
      return { candidate: withWriter, verdict: "rejected", reason: verdict.reason, commit: false };
    }
  );

  return {
    facts,
    evidence,
    fieldValues,
    transition: classifyTransition(proposal.transition, current)
  };
}

/**
 * Whether a stage change may even be attempted.
 *
 * Only the obvious refusals are made here - an unknown stage, a move to the
 * stage the contact is already in, a change with no reason. Whether the move
 * itself is allowed is `authorizeLifecycleTransition`'s decision and is taken
 * at the point of writing, because it is the same decision a person's move goes
 * through and there must not be two answers to it.
 */
function classifyTransition(
  transition: ProposedTransition | undefined,
  current: CurrentCrmState
): Classified<ProposedTransition> | null {
  if (!transition) return null;
  if (!LIFECYCLE_STAGES.includes(transition.to)) {
    return { candidate: transition, verdict: "rejected", reason: "no such stage", commit: false };
  }
  if (transition.to === current.lifecycleStage) {
    return { candidate: transition, verdict: "rejected", reason: "already there", commit: false };
  }
  if (transition.reasonCodes.length === 0) {
    // The rule the lifecycle table was built around: a stage that moved for no
    // recorded reason cannot be explained to the owner or corrected later.
    return {
      candidate: transition,
      verdict: "rejected",
      reason: "a stage change names its reason",
      commit: false
    };
  }
  return { candidate: transition, verdict: "inferred", reason: "eligible", commit: true };
}

/** What the caller reports afterwards: how many of each class, for the trace. */
export function summariseProposal(classified: ClassifiedProposal): Record<WriteClass, number> {
  const counts: Record<WriteClass, number> = {
    confirmed: 0,
    inferred: 0,
    conflicted: 0,
    rejected: 0
  };
  const all = [
    ...classified.facts,
    ...classified.evidence,
    ...classified.fieldValues,
    ...(classified.transition ? [classified.transition] : [])
  ];
  for (const item of all) counts[item.verdict] += 1;
  return counts;
}
