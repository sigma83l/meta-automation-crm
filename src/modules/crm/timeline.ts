/**
 * The relationship, reconstructed without drowning the operator in machinery.
 *
 * `09_TIMELINE_EVENT_MODEL.md` sets the goal in one line and the whole design
 * follows from it: messages, notes, tasks, lifecycle and score changes,
 * bookings, handoffs and memory corrections are what happened; automation
 * internals, retries, read-model refreshes and telemetry are how it happened,
 * and an operator asked the first question. So every event says whether it is
 * routine, and the default view hides the routine ones rather than dropping
 * them - "collapsed", not "deleted", because the moment somebody is debugging a
 * bad reply the machinery is exactly what they need.
 *
 * The source rows are immutable and stay where they are. This derives a
 * presentation of them, which is the pack's other rule, and it means an event
 * here can be regenerated from its source and never has to be migrated.
 *
 * Events carry a `kind` and the values that phrasing needs rather than a
 * finished sentence, because the product ships in three languages and a summary
 * assembled here would only ever be in one. Text somebody actually wrote - a
 * note, a stored activity summary - passes through as written.
 *
 * Pure by design; no I/O.
 */

import type { EvidenceLink } from "./now-card";

export const TIMELINE_CATEGORIES = [
  "messages",
  "crm_changes",
  "ai_automation",
  "tasks",
  "outcomes",
  "admin"
] as const;
export type TimelineCategory = (typeof TIMELINE_CATEGORIES)[number];

export const TIMELINE_KINDS = [
  "message_inbound",
  "message_outbound",
  "note_added",
  "record_activity",
  "stage_changed",
  "score_changed",
  "followup_scheduled",
  "followup_settled",
  "opportunity_opened",
  "opportunity_settled",
  "handoff_raised",
  "automation_linked",
  "audit_action"
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

/**
 * Who did it.
 *
 * `workspace` rather than a person for an outbound message: `messages` records
 * that it went out from here and not who wrote it, and naming a person the
 * table does not name would be an invention. Which of the two was answering at
 * the time is a question the handoff and takeover events answer.
 */
export const TIMELINE_ACTORS = [
  "customer",
  "workspace",
  "operator",
  "automation",
  "system"
] as const;
export type TimelineActor = (typeof TIMELINE_ACTORS)[number];

export type TimelineEvent = Readonly<{
  /** Stable across reads: the source table and the row's own id. */
  id: string;
  at: string;
  category: TimelineCategory;
  kind: TimelineKind;
  actor: TimelineActor;
  /** The values the UI needs to phrase this event in the reader's language. */
  detail: Readonly<Record<string, string>>;
  /** Words somebody wrote. Shown as written, never translated or summarised. */
  text: string | null;
  evidence: EvidenceLink | null;
  /** Machinery rather than history: hidden until somebody asks for it. */
  routine: boolean;
}>;

export type TimelineInput = Readonly<{
  messages: readonly Readonly<{
    id: string;
    conversationId: string;
    direction: "inbound" | "outbound";
    body: string;
    sentAt: string;
  }>[];
  notes: readonly Readonly<{ id: string; body: string; createdAt: string }>[];
  activities: readonly Readonly<{
    id: string;
    type: string;
    summary: string;
    occurredAt: string;
  }>[];
  lifecycle: readonly Readonly<{
    id: string;
    fromStage: string | null;
    toStage: string;
    reasonCodes: readonly string[];
    actor: string;
    evidenceRef: string | null;
    occurredAt: string;
  }>[];
  scores: readonly Readonly<{
    id: string;
    score: number;
    previousScore: number | null;
    configVersion: string;
    overrideBy: string | null;
    calculatedAt: string;
  }>[];
  followUps: readonly Readonly<{
    id: string;
    objective: string;
    dueAt: string;
    eligibilityState: "eligible" | "blocked" | "cancelled" | "completed";
    ownerType: string;
    lastResult: string | null;
    createdAt: string;
    updatedAt: string;
  }>[];
  opportunities: readonly Readonly<{
    id: string;
    stage: string;
    valueBand: string | null;
    outcomeSource: string | null;
    createdAt: string;
    updatedAt: string;
  }>[];
  handoffs: readonly Readonly<{ id: string; trigger: string; raisedAt: string }>[];
  automations: readonly Readonly<{
    id: string;
    automationKey: string;
    state: string;
    createdAt: string;
  }>[];
  audit: readonly Readonly<{ id: string; action: string; occurredAt: string }>[];
}>;

export const EMPTY_TIMELINE: TimelineInput = Object.freeze({
  messages: [],
  notes: [],
  activities: [],
  lifecycle: [],
  scores: [],
  followUps: [],
  opportunities: [],
  handoffs: [],
  automations: [],
  audit: []
});

/** A uuid is a person; anything else in an actor column is a machine. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actorOf = (actor: string): TimelineActor => (UUID.test(actor) ? "operator" : "system");

export function buildTimeline(input: TimelineInput): readonly TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const message of input.messages) {
    events.push({
      id: `message:${message.id}`,
      at: message.sentAt,
      category: "messages",
      kind: message.direction === "inbound" ? "message_inbound" : "message_outbound",
      actor: message.direction === "inbound" ? "customer" : "workspace",
      detail: {},
      text: message.body,
      evidence: { kind: "conversation", ref: message.conversationId },
      routine: false
    });
  }

  for (const note of input.notes) {
    events.push({
      id: `note:${note.id}`,
      at: note.createdAt,
      category: "crm_changes",
      kind: "note_added",
      actor: "operator",
      detail: {},
      text: note.body,
      evidence: null,
      routine: false
    });
  }

  for (const activity of input.activities) {
    events.push({
      id: `activity:${activity.id}`,
      at: activity.occurredAt,
      category: "crm_changes",
      kind: "record_activity",
      actor: "operator",
      detail: { type: activity.type },
      // Stored in English by whoever wrote the row. Shown as written rather
      // than machine-translated into a claim nobody made.
      text: activity.summary,
      evidence: null,
      routine: false
    });
  }

  for (const event of input.lifecycle) {
    events.push({
      id: `lifecycle:${event.id}`,
      at: event.occurredAt,
      category: "crm_changes",
      kind: "stage_changed",
      actor: actorOf(event.actor),
      detail: {
        from: event.fromStage ?? "",
        to: event.toStage,
        reasons: event.reasonCodes.join(", ")
      },
      text: null,
      evidence: event.evidenceRef ? { kind: "evidence", ref: event.evidenceRef } : null,
      routine: false
    });
  }

  for (const snapshot of input.scores) {
    // A recomputation that moved nothing is a read-model refresh, which the
    // pack names among the things to collapse. It stays in the trace because a
    // score that stopped moving is sometimes the question.
    const unchanged = snapshot.previousScore === snapshot.score;
    events.push({
      id: `score:${snapshot.id}`,
      at: snapshot.calculatedAt,
      category: "crm_changes",
      kind: "score_changed",
      actor: snapshot.overrideBy ? "operator" : "system",
      detail: {
        score: String(snapshot.score),
        previous: snapshot.previousScore === null ? "" : String(snapshot.previousScore),
        version: snapshot.configVersion
      },
      text: null,
      evidence: { kind: "score", ref: snapshot.id },
      routine: unchanged
    });
  }

  for (const followUp of input.followUps) {
    events.push({
      id: `followup:${followUp.id}`,
      at: followUp.createdAt,
      category: "tasks",
      kind: "followup_scheduled",
      actor: followUp.ownerType === "human" ? "operator" : "automation",
      detail: { due: followUp.dueAt },
      text: followUp.objective,
      evidence: { kind: "followup", ref: followUp.id },
      routine: false
    });
    if (followUp.eligibilityState !== "eligible") {
      events.push({
        id: `followup-settled:${followUp.id}`,
        at: followUp.updatedAt,
        category: "tasks",
        kind: "followup_settled",
        actor: followUp.ownerType === "human" ? "operator" : "automation",
        detail: { state: followUp.eligibilityState, result: followUp.lastResult ?? "" },
        text: followUp.objective,
        evidence: { kind: "followup", ref: followUp.id },
        routine: false
      });
    }
  }

  for (const opportunity of input.opportunities) {
    events.push({
      id: `opportunity:${opportunity.id}`,
      at: opportunity.createdAt,
      category: "outcomes",
      kind: "opportunity_opened",
      actor: "operator",
      detail: { band: opportunity.valueBand ?? "" },
      text: null,
      evidence: null,
      routine: false
    });
    if (opportunity.stage === "won" || opportunity.stage === "lost") {
      events.push({
        id: `opportunity-settled:${opportunity.id}`,
        at: opportunity.updatedAt,
        category: "outcomes",
        kind: "opportunity_settled",
        actor: "operator",
        detail: { stage: opportunity.stage, source: opportunity.outcomeSource ?? "" },
        text: null,
        evidence: null,
        routine: false
      });
    }
  }

  for (const handoff of input.handoffs) {
    events.push({
      id: `handoff:${handoff.id}`,
      at: handoff.raisedAt,
      category: "ai_automation",
      kind: "handoff_raised",
      actor: "automation",
      detail: { trigger: handoff.trigger },
      text: null,
      evidence: null,
      routine: false
    });
  }

  for (const automation of input.automations) {
    events.push({
      id: `automation:${automation.id}`,
      at: automation.createdAt,
      category: "ai_automation",
      kind: "automation_linked",
      actor: "automation",
      detail: { key: automation.automationKey, state: automation.state },
      text: null,
      evidence: null,
      // Machinery. Real when something goes wrong, noise the rest of the time.
      routine: true
    });
  }

  for (const entry of input.audit) {
    events.push({
      id: `audit:${entry.id}`,
      at: entry.occurredAt,
      category: "admin",
      kind: "audit_action",
      actor: "operator",
      detail: { action: entry.action },
      text: null,
      evidence: null,
      routine: true
    });
  }

  // Newest first, and stable: two events at the same instant must not swap
  // places between reads, or the timeline looks alive when nothing happened.
  return events.sort((left, right) =>
    left.at === right.at ? left.id.localeCompare(right.id) : left.at < right.at ? 1 : -1
  );
}

export type TimelineFilter = Readonly<{
  categories?: readonly TimelineCategory[];
  /** Off by default: the machinery is there when somebody asks for it. */
  includeRoutine?: boolean;
}>;

export function filterTimeline(
  events: readonly TimelineEvent[],
  filter: TimelineFilter = {}
): readonly TimelineEvent[] {
  const categories = filter.categories?.length ? new Set(filter.categories) : null;
  return events.filter(
    (event) =>
      (filter.includeRoutine || !event.routine) && (!categories || categories.has(event.category))
  );
}

export function isTimelineCategory(value: unknown): value is TimelineCategory {
  return typeof value === "string" && (TIMELINE_CATEGORIES as readonly string[]).includes(value);
}
