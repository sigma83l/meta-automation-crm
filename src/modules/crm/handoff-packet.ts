/**
 * The packet a human receives when a conversation is handed to them.
 *
 * A handoff exists to spare the person scrolling the thread. If they have to
 * read it anyway the handoff has failed, so the packet is a fixed shape with
 * nine required sections rather than free text — and the sections that cannot be
 * filled say so explicitly, because an absent section reads as "nothing to
 * report" and an unknown one is a different claim entirely.
 *
 * Nothing here is generated: every field is assembled from records the system
 * already holds. Pure by design.
 */

import type { LeadStatus, LifecycleStage } from "./revenue-state";

export const HANDOFF_SECTIONS = [
  "summary",
  "intent",
  "mentalState",
  "knownFacts",
  "score",
  "objections",
  "actionsTaken",
  "suggestedNextAction",
  "policyFlags",
  "owner"
] as const;

export type HandoffSection = (typeof HANDOFF_SECTIONS)[number];

/** Why the conversation left the automated path. */
export const HANDOFF_TRIGGERS = [
  "customer_requested_human",
  "confidence_below_threshold",
  "policy_block",
  "high_value_objection",
  "repeated_failure",
  "owner_takeover"
] as const;

export type HandoffTrigger = (typeof HANDOFF_TRIGGERS)[number];

export type HandoffInput = Readonly<{
  trigger: HandoffTrigger;
  summary: string;
  intent: string;
  /** How the customer appears to be feeling, from observed signals only. */
  mentalState: string;
  knownFacts: readonly Readonly<{ key: string; value: string; sourceRef: string }>[];
  qualificationScore: number;
  scoreReasons: readonly string[];
  objections: readonly string[];
  actionsTaken: readonly string[];
  suggestedNextAction: string;
  policyFlags: readonly string[];
  ownerId: string | null;
  lifecycleStage: LifecycleStage;
  leadStatus: LeadStatus;
}>;

export type HandoffPacket = Readonly<{
  trigger: HandoffTrigger;
  summary: string;
  intent: string;
  mentalState: string;
  knownFacts: readonly Readonly<{ key: string; value: string; sourceRef: string }>[];
  score: Readonly<{ value: number; reasons: readonly string[] }>;
  objections: readonly string[];
  actionsTaken: readonly string[];
  suggestedNextAction: string;
  policyFlags: readonly string[];
  owner: Readonly<{ ownerId: string | null; slaMinutes: number }>;
  lifecycleStage: LifecycleStage;
  leadStatus: LeadStatus;
  /** Sections with nothing to report, named rather than silently empty. */
  unknownSections: readonly HandoffSection[];
}>;

/**
 * How long the customer may wait before the handoff is breached.
 *
 * Someone who asked for a person is already waiting; someone blocked by policy
 * is stuck and cannot make progress at all. Both get short clocks. A takeover
 * the owner initiated needs none, since they are already looking at it.
 */
export const SLA_MINUTES: Readonly<Record<HandoffTrigger, number>> = Object.freeze({
  customer_requested_human: 15,
  confidence_below_threshold: 60,
  policy_block: 15,
  high_value_objection: 30,
  repeated_failure: 30,
  owner_takeover: 0
});

const PLACEHOLDER = "not established";

function textOrPlaceholder(value: string): string {
  return value.trim() === "" ? PLACEHOLDER : value.trim();
}

/**
 * Assembles the packet, recording what is missing instead of hiding it.
 *
 * A blank field would be read as "no objections" or "no policy concerns"; naming
 * it as unknown tells the human where they still have to look, which is the one
 * thing the packet cannot work out for them.
 */
export function buildHandoffPacket(input: HandoffInput): HandoffPacket {
  const unknown: HandoffSection[] = [];

  const summary = textOrPlaceholder(input.summary);
  if (summary === PLACEHOLDER) unknown.push("summary");

  const intent = textOrPlaceholder(input.intent);
  if (intent === PLACEHOLDER) unknown.push("intent");

  const mentalState = textOrPlaceholder(input.mentalState);
  if (mentalState === PLACEHOLDER) unknown.push("mentalState");

  if (!input.knownFacts.length) unknown.push("knownFacts");

  // A score with no reasons is a number the human cannot check, so it counts as
  // unknown however confident it looks.
  if (!input.scoreReasons.length) unknown.push("score");

  if (!input.objections.length) unknown.push("objections");
  if (!input.actionsTaken.length) unknown.push("actionsTaken");

  const next = textOrPlaceholder(input.suggestedNextAction);
  if (next === PLACEHOLDER) unknown.push("suggestedNextAction");

  if (!input.policyFlags.length) unknown.push("policyFlags");
  if (!input.ownerId) unknown.push("owner");

  return {
    trigger: input.trigger,
    summary,
    intent,
    mentalState,
    // Facts arrive with provenance and keep it: a fact the human cannot trace is
    // one they have to verify themselves.
    knownFacts: input.knownFacts.filter((fact) => fact.sourceRef.trim() !== ""),
    score: { value: input.qualificationScore, reasons: input.scoreReasons },
    objections: input.objections,
    actionsTaken: input.actionsTaken,
    suggestedNextAction: next,
    policyFlags: input.policyFlags,
    owner: { ownerId: input.ownerId, slaMinutes: SLA_MINUTES[input.trigger] },
    lifecycleStage: input.lifecycleStage,
    leadStatus: input.leadStatus,
    unknownSections: unknown
  };
}

/**
 * Whether the packet is complete enough to hand over unattended.
 *
 * Deliberately narrow. Objections and policy flags are commonly empty for good
 * reason — most conversations have neither — so requiring them would make every
 * packet incomplete and the check worthless. What a human genuinely cannot
 * proceed without is what the conversation is about and what to do next.
 */
export function isActionable(packet: HandoffPacket): boolean {
  const required: readonly HandoffSection[] = ["summary", "intent", "suggestedNextAction"];
  return !required.some((section) => packet.unknownSections.includes(section));
}

/** Whether the SLA clock has run out for a packet raised at `raisedAt`. */
export function isSlaBreached(packet: HandoffPacket, raisedAt: Date, now: Date): boolean {
  if (packet.owner.slaMinutes === 0) return false;
  const elapsedMinutes = (now.getTime() - raisedAt.getTime()) / 60_000;
  return elapsedMinutes > packet.owner.slaMinutes;
}
