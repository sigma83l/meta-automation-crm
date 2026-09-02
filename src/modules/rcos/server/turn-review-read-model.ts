import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Why a conversation is waiting for a person.
 *
 * The pipeline records every turn it refuses, with the reasons, and until now
 * nothing read that back. An operator opening a flagged conversation could see
 * that it needed review but not why, which makes the flag an interruption
 * rather than a piece of work: the two most common causes - a model that is not
 * configured and a workspace escalation keyword - need completely different
 * responses, and one of them is not the operator's job at all.
 *
 * Reason codes are internal identifiers. They are mapped to sentences at the
 * edge rather than stored as prose, because they are also matched on in tests
 * and in the engine, and a table of translations is not something to duplicate
 * per locale in the database.
 */

/** Codes this surface explains. Anything else is shown as itself. */
export const REVIEW_REASONS = [
  // From the validator.
  "empty_draft",
  "ungrounded_claim",
  "unverified_money",
  "unverified_time",
  "unclaimed_success",
  "pii_leak",
  "policy_violation",
  "pressure_tactic",
  "duplicate_send",
  // From the decision port.
  "escalation_keyword",
  "low_confidence",
  // From the policy port.
  "human_takeover",
  "conversation_closed",
  "conversation_missing",
  "billing_entitlement_required",
  "ai_replies_disabled",
  "ai_replies_paused"
] as const;

export type ReviewReason = (typeof REVIEW_REASONS)[number];

export type TurnReview = Readonly<{
  outcome: string;
  reasonCodes: readonly string[];
  occurredAt: string;
}>;

export function isReviewReason(value: string): value is ReviewReason {
  return (REVIEW_REASONS as readonly string[]).includes(value);
}

function toReview(row: Readonly<Record<string, unknown>>): TurnReview {
  return Object.freeze({
    outcome: String(row.outcome),
    reasonCodes: ((row.reason_codes as string[] | null) ?? []).map(String),
    occurredAt: String(row.created_at)
  });
}

/**
 * The most recent turn on a conversation.
 *
 * One row, not a history. The question this answers is "why is this in front of
 * me now", and an operator scrolling every automated turn would be reading
 * telemetry rather than doing the work. The full history stays in
 * `turn_records` for whoever needs it.
 */
export async function latestTurnReview(
  client: SupabaseClient,
  workspaceId: string,
  conversationId: string
): Promise<TurnReview | undefined> {
  const { data, error } = await client
    .from("turn_records")
    .select("outcome,reason_codes,created_at")
    .eq("workspace_id", workspaceId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // A missing explanation must not take the conversation down with it. The
  // messages are what the operator actually came for.
  if (error || !data) return undefined;
  return toReview(data);
}

/**
 * Which conversations in a list are waiting on a person.
 *
 * Read separately from the conversations themselves, so the existing list query
 * is untouched: this is additive to a page that already worked, and a join
 * would turn the flag's absence into a rendering problem rather than an empty
 * map.
 */
export async function conversationsAwaitingReview(
  client: SupabaseClient,
  workspaceId: string,
  conversationIds: readonly string[]
): Promise<ReadonlyMap<string, TurnReview>> {
  if (conversationIds.length === 0) return new Map();

  const { data, error } = await client
    .from("turn_records")
    .select("conversation_id,outcome,reason_codes,created_at")
    .eq("workspace_id", workspaceId)
    .in("conversation_id", [...conversationIds])
    .eq("outcome", "handoff")
    .order("created_at", { ascending: false });
  if (error || !data) return new Map();

  // Newest first, so the first row seen for a conversation is its latest
  // handoff and the rest are history.
  const latest = new Map<string, TurnReview>();
  for (const row of data) {
    const id = String(row.conversation_id);
    if (latest.has(id)) continue;
    latest.set(id, toReview(row));
  }
  return latest;
}
