/**
 * The first-party event taxonomy.
 *
 * The pack's model is two ledgers, and the asymmetry between them is the whole
 * design: this one is canonical operational truth, and an external analytics
 * tool is a visualisation consumer that may never be trusted to hold anything
 * it does not need. Everything downstream — funnels, read models, the usage
 * page — is derived from the rows this taxonomy describes, so the events are
 * immutable and the aggregates are rebuildable.
 *
 * Event names are closed rather than free-form strings. An open vocabulary
 * drifts within a fortnight — `trial.started`, `trial_started`, `trialStart`
 * all coexist and no funnel spans them — and by then the history is unfixable
 * because the events are immutable.
 */

export const ACQUISITION_EVENTS = [
  "marketing.page_viewed",
  "cta_clicked",
  "demo.started",
  "demo.completed",
  "conversation.marketing_started",
  "pilot.requested"
] as const;

export const ACTIVATION_EVENTS = [
  "workspace.provisioned",
  "onboarding.stage_completed",
  "channel.connected",
  "first_meaningful_received",
  "ai.first_useful_reply"
] as const;

export const OUTCOME_EVENTS = [
  "lead.first_qualified",
  "lifecycle.changed",
  "handoff.completed",
  "appointment.booked_verified",
  "opportunity.won",
  "opportunity.lost"
] as const;

export const PRODUCT_EVENTS = [
  "workspace.active_week",
  "automation.activated",
  "followup.recovered",
  "integration.degraded"
] as const;

export const BILLING_EVENTS = [
  "trial.started",
  "trial.expired",
  "trial.capped",
  "subscription.started",
  "subscription.updated",
  "subscription.canceled",
  "entitlement.changed",
  "usage.threshold_crossed"
] as const;

export const RELIABILITY_EVENTS = [
  "webhook.failed",
  "queue.backlog",
  "provider.retry",
  "ai.validation_failed",
  "send.failed"
] as const;

export const GROWTH_EVENTS = [
  "content_asset.assisted",
  "partner_referral.activated",
  "referral.activated",
  "experiment.exposed"
] as const;

export const ANALYTICS_EVENTS = [
  ...ACQUISITION_EVENTS,
  ...ACTIVATION_EVENTS,
  ...OUTCOME_EVENTS,
  ...PRODUCT_EVENTS,
  ...BILLING_EVENTS,
  ...RELIABILITY_EVENTS,
  ...GROWTH_EVENTS
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export const EVENT_GROUPS = [
  "acquisition",
  "activation",
  "outcome",
  "product",
  "billing",
  "reliability",
  "growth"
] as const;

export type EventGroup = (typeof EVENT_GROUPS)[number];

const GROUP_MEMBERSHIP: Readonly<Record<EventGroup, readonly string[]>> = Object.freeze({
  acquisition: ACQUISITION_EVENTS,
  activation: ACTIVATION_EVENTS,
  outcome: OUTCOME_EVENTS,
  product: PRODUCT_EVENTS,
  billing: BILLING_EVENTS,
  reliability: RELIABILITY_EVENTS,
  growth: GROWTH_EVENTS
});

export function groupForEvent(name: AnalyticsEventName): EventGroup {
  for (const group of EVENT_GROUPS) {
    if (GROUP_MEMBERSHIP[group].includes(name)) return group;
  }
  // Unreachable while the type holds; a runtime caller passing a bare string
  // gets a refusal rather than a wrong group.
  throw new Error(`Unknown analytics event: ${name}`);
}

export function isAnalyticsEvent(name: string): name is AnalyticsEventName {
  return (ANALYTICS_EVENTS as readonly string[]).includes(name);
}

/**
 * The activation funnel, in order.
 *
 * Named here rather than assembled at each call site so that "how many
 * workspaces got as far as a useful reply" has exactly one answer. Two
 * definitions of a funnel is two numbers, and the difference between them is
 * never noticed until someone makes a decision on the wrong one.
 */
export const ACTIVATION_FUNNEL: readonly AnalyticsEventName[] = Object.freeze([
  "workspace.provisioned",
  "onboarding.stage_completed",
  "channel.connected",
  "first_meaningful_received",
  "ai.first_useful_reply"
]);

/**
 * How far a workspace got through the funnel.
 *
 * Counts the longest prefix reached, not the number of steps seen: a workspace
 * that somehow recorded step 4 without step 3 has not completed step 4 in any
 * sense a funnel should report, and quietly counting it would hide the very
 * gap worth investigating.
 */
export function funnelDepth(seen: readonly AnalyticsEventName[]): number {
  let depth = 0;
  for (const step of ACTIVATION_FUNNEL) {
    if (!seen.includes(step)) break;
    depth += 1;
  }
  return depth;
}
