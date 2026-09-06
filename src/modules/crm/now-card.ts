/**
 * What is true about this contact right now, and how much of it is known.
 *
 * `03_CUSTOMER_RECORD_NOW_CARD.md` is the pack's distinctive element and states
 * one rule twice: every value links to its evidence where possible, and
 * anything unknown says **Unknown / Needs confirmation** rather than being
 * omitted or filled in. Never manufacture completeness.
 *
 * That rule is what the types here enforce. A field is either a value with
 * whatever backs it, or it is `null` - and `null` renders as the words, not as
 * a blank cell or a skipped row. There is no shape in this file that can carry
 * a value with no provenance and no way to say where it came from, because a
 * card that looks complete by hiding its gaps is worse than the raw dump it
 * replaces: the dump at least admitted it knew nothing.
 *
 * Nothing here is stored. Every field is a function of current state, and the
 * card is assembled on read for the same reason attention priority is - a saved
 * one is a cache with no invalidation, telling an operator the customer still
 * wants what they wanted last month.
 *
 * Pure by design; no I/O.
 */

import { rankAttention, type AttentionVerdict } from "./attention-priority";
import { proposeNextAction, type NextActionState, type ProposedAction } from "./next-action";
import type { ScoreBlocker, ScoreDriver } from "./qualification-score";
import type { LeadStatus, LifecycleStage } from "./revenue-state";
import {
  FACT_CONFIDENCES,
  type FactConfidence,
  type StoredFact
} from "@/src/modules/rcos/memory-policy";

/**
 * The memory keys the record reads by name.
 *
 * Customer memory is otherwise the workspace's own vocabulary - a model may
 * file whatever it learns under whatever key fits. These two are reserved,
 * because the card asks specific questions and cannot go looking for an answer
 * under a name nobody agreed on. `crm_radar_view` reads `current_need` by the
 * same name for the index's column.
 */
export const NOW_FACT_KEYS = Object.freeze({
  intent: "current_need",
  outcome: "desired_outcome"
});

/** Where a value came from, addressable enough for the UI to link to it. */
export type EvidenceLink = Readonly<{
  kind: "message" | "conversation" | "memory" | "score" | "evidence" | "followup";
  ref: string;
}>;

/**
 * A value the card can show, or `null` for Unknown / Needs confirmation.
 *
 * `evidence` is nullable and `confidence` optional because "known, and here is
 * why" and "known, from somewhere unrecorded" are different claims. Collapsing
 * them would let an unsourced value borrow the authority of a sourced one.
 */
export type NowField<T> = Readonly<{
  value: T;
  evidence: EvidenceLink | null;
  confidence?: FactConfidence;
}> | null;

export const DUE_STATES = ["overdue", "due_soon", "scheduled", "none"] as const;
export type DueState = (typeof DUE_STATES)[number];

export type NowCard = Readonly<{
  currentIntent: NowField<string>;
  desiredOutcome: NowField<string>;
  lifecycleStage: LifecycleStage;
  leadStatus: LeadStatus;
  attention: AttentionVerdict;
  score: NowField<number>;
  strongestEvidence: NowField<ScoreDriver>;
  strongestBlocker: NowField<ScoreBlocker>;
  /**
   * How far the card's remembered values can be trusted: the weakest confidence
   * among them, and null when nothing has been established at all.
   *
   * The weakest rather than an average, because a card is read as one claim and
   * one guess in it makes the whole thing a guess. The score's own confidence -
   * a 0..1 over evidence strength - is deliberately not folded in: the two are
   * different scales, and combining them would produce a number with no
   * meaning either of them could defend.
   */
  dataConfidence: FactConfidence | null;
  nextAction: ProposedAction;
  dueState: DueState;
  /** Who is answering: the automation, or a person who took over. Null with no conversation. */
  handling: "automation" | "human" | null;
  lastMessage: NowField<
    Readonly<{ direction: "inbound" | "outbound"; excerpt: string; at: string }>
  >;
}>;

export type NowCardInput = Readonly<{
  state: NextActionState;
  /** Customer memory, as stored. Expired facts are filtered here, not by the caller. */
  facts: readonly StoredFact[];
  score: Readonly<{
    id: string;
    score: number;
    topDrivers: readonly ScoreDriver[];
    topBlockers: readonly ScoreBlocker[];
    evidenceRefs: readonly string[];
  }> | null;
  lastMessage: Readonly<{
    id: string;
    conversationId: string;
    direction: "inbound" | "outbound";
    body: string;
    sentAt: string;
  }> | null;
  handling: "automation" | "human" | null;
}>;

/** How much of a message the card shows before it stops being a summary. */
const EXCERPT = 160;

const strength = (confidence: FactConfidence) => FACT_CONFIDENCES.indexOf(confidence);

function factField(facts: readonly StoredFact[], key: string, now: Date): NowField<string> {
  const fact = facts.find((candidate) => candidate.key === key);
  if (!fact) return null;
  // The memory policy's own rule: an expired fact is absent. Showing it as
  // current is the one thing worse than showing nothing, because the operator
  // has no way to tell it is stale.
  if (fact.validUntil && new Date(fact.validUntil).getTime() <= now.getTime()) return null;
  return {
    value: fact.value,
    evidence: { kind: "memory", ref: fact.sourceRef },
    confidence: fact.confidence
  };
}

/**
 * Which of the two evidence components is the strongest positive one.
 *
 * `topDrivers` is already ordered by the score engine, so this takes its word
 * rather than re-ranking: a card disagreeing with the score's own account of
 * itself is how an operator learns to distrust both.
 */
function driverField(input: NowCardInput["score"]): NowField<ScoreDriver> {
  const driver = input?.topDrivers[0];
  if (!driver) return null;
  const ref = input?.evidenceRefs[0] ?? null;
  return { value: driver, evidence: ref ? { kind: "evidence", ref } : null };
}

function blockerField(input: NowCardInput["score"]): NowField<ScoreBlocker> {
  const blocker = input?.topBlockers[0];
  if (!blocker) return null;
  // A blocker is an absence - points not earned, or a disqualifier applied - so
  // there is nothing to link to. Saying so beats inventing a reference.
  return { value: blocker, evidence: null };
}

/**
 * Whether anything is late.
 *
 * Read off the attention verdict rather than recomputed from timestamps: the
 * rules for what counts as overdue and what counts as due soon already live
 * there, and a second set here would eventually disagree with the priority
 * chip sitting next to it.
 */
function dueStateFrom(attention: AttentionVerdict, action: ProposedAction): DueState {
  const codes = new Set(attention.reasons.map((reason) => reason.code));
  if (codes.has("followup_overdue")) return "overdue";
  if (codes.has("followup_due_soon")) return "due_soon";
  return action.dueAt ? "scheduled" : "none";
}

export function buildNowCard(input: NowCardInput, now: Date = new Date()): NowCard {
  const attention = rankAttention(input.state, now);
  const nextAction = proposeNextAction(input.state, now);
  const currentIntent = factField(input.facts, NOW_FACT_KEYS.intent, now);
  const desiredOutcome = factField(input.facts, NOW_FACT_KEYS.outcome, now);

  const remembered = [currentIntent, desiredOutcome]
    .map((field) => field?.confidence)
    .filter((confidence): confidence is FactConfidence => Boolean(confidence));

  return {
    currentIntent,
    desiredOutcome,
    lifecycleStage: input.state.lifecycleStage,
    leadStatus: input.state.leadStatus,
    attention,
    score: input.score
      ? { value: input.score.score, evidence: { kind: "score", ref: input.score.id } }
      : null,
    strongestEvidence: driverField(input.score),
    strongestBlocker: blockerField(input.score),
    dataConfidence: remembered.length
      ? remembered.reduce((weakest, confidence) =>
          strength(confidence) < strength(weakest) ? confidence : weakest
        )
      : null,
    nextAction,
    dueState: dueStateFrom(attention, nextAction),
    handling: input.handling,
    lastMessage: input.lastMessage
      ? {
          value: {
            direction: input.lastMessage.direction,
            excerpt: excerpt(input.lastMessage.body),
            at: input.lastMessage.sentAt
          },
          evidence: { kind: "conversation", ref: input.lastMessage.conversationId }
        }
      : null
  };
}

/** A message summary, cut on a word where one is near enough to the limit. */
function excerpt(body: string): string {
  const collapsed = body.replaceAll(/\s+/g, " ").trim();
  if (collapsed.length <= EXCERPT) return collapsed;
  const cut = collapsed.slice(0, EXCERPT);
  const space = cut.lastIndexOf(" ");
  return `${(space > EXCERPT - 24 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
