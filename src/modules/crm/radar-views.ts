/**
 * The lists an operator picks between, and what each one means.
 *
 * `02_CRM_INFORMATION_ARCHITECTURE.md` names seven, and the pack's rule for the
 * eighth kind - a saved view somebody defines - is that it is a server-owned
 * query definition, workspace scoped. So a view is a set of values drawn from
 * vocabularies this module already fixes, never a filter expression: nothing a
 * caller writes reaches the database as syntax, and a saved view is stored as
 * the same values in typed columns.
 *
 * Two of the seven cannot be expressed as column equality, and that is the
 * interesting part. "Needs Attention" and "Follow-up Due" are questions about
 * the attention verdict, which is computed in TypeScript from rules the pack
 * puts there. Re-deriving them in SQL would leave two implementations of the
 * same rule to keep in step - a contact in the Needs Attention list whose
 * record screen says Normal - so those two filter the ranked row instead of the
 * query. The repository pays for that by reading further, not by guessing.
 *
 * Pure by design; no I/O.
 */

import type { AttentionVerdict } from "./attention-priority";
import type { LeadStatus, LifecycleStage } from "./revenue-state";

export const RADAR_VIEW_KEYS = [
  "needs_attention",
  "all_customers",
  "follow_up_due",
  "qualified",
  "sales_ready",
  "customers",
  "recently_active"
] as const;
export type RadarViewKey = (typeof RADAR_VIEW_KEYS)[number];

/** The two questions the ranked row answers and a column cannot. */
export const ATTENTION_FILTERS = ["needs_attention", "follow_up_due"] as const;
export type AttentionFilter = (typeof ATTENTION_FILTERS)[number];

/**
 * A view, as values.
 *
 * Every field is optional and every one of them is closed: a stage, a status, a
 * number of days. There is deliberately no field holding a fragment of a query,
 * because the moment one exists a saved view becomes a way to hand the database
 * something a person typed.
 */
export type RadarViewFilters = Readonly<{
  status?: "active" | "archived";
  lifecycleStage?: LifecycleStage;
  leadStatus?: LeadStatus;
  /** Last activity no older than this. */
  activeWithinDays?: number;
  attention?: AttentionFilter;
}>;

/** How recent "Recently Active" means. A week is one working cycle. */
export const RECENTLY_ACTIVE_DAYS = 7;

export const BUILT_IN_RADAR_VIEWS: Readonly<Record<RadarViewKey, RadarViewFilters>> = Object.freeze(
  {
    needs_attention: { attention: "needs_attention" },
    // Everything, archived included. A view that quietly hides rows is worse than
    // one that shows more than wanted: the status control is right there.
    all_customers: {},
    follow_up_due: { attention: "follow_up_due" },
    qualified: { lifecycleStage: "qualified" },
    sales_ready: { lifecycleStage: "sales_ready" },
    customers: { lifecycleStage: "customer" },
    recently_active: { activeWithinDays: RECENTLY_ACTIVE_DAYS }
  }
);

export function isRadarViewKey(value: unknown): value is RadarViewKey {
  return typeof value === "string" && (RADAR_VIEW_KEYS as readonly string[]).includes(value);
}

/**
 * Whether a ranked row belongs in an attention-filtered view.
 *
 * "Needs attention" is a raising reason that survived: something argues for
 * action and nothing capped the row to Low. A row capped to Low - opted out,
 * closed - is precisely the row an operator should not be handed, however
 * loudly it would otherwise have argued.
 */
export function matchesAttention(filter: AttentionFilter, verdict: AttentionVerdict): boolean {
  if (filter === "follow_up_due") {
    return verdict.reasons.some(
      (reason) => reason.code === "followup_overdue" || reason.code === "followup_due_soon"
    );
  }
  return verdict.priority !== "low" && verdict.reasons.some((reason) => reason.effect === "raises");
}

/**
 * Where the index lands.
 *
 * `Needs Attention` when there is anything in it, otherwise `All Customers`.
 * Landing on an empty queue reads as a broken page; landing on the full list
 * when there is real work waiting buries it.
 */
export function landingRadarView(hasAttentionSignals: boolean): RadarViewKey {
  return hasAttentionSignals ? "needs_attention" : "all_customers";
}
