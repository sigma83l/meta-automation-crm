import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { WorkspaceOverview } from "@/src/modules/workspaces/contracts";

/**
 * Reads `workspace_overview_view`.
 *
 * The view is `security_invoker`, so it is queried with the caller's client
 * and the caller's RLS decides which rows exist. Reading it through the admin
 * client would return every workspace's figures and would not error while
 * doing it.
 */

type OverviewRow = Readonly<{
  conversations_awaiting_human: number | null;
  handoffs_open: number | null;
  followups_due: number | null;
  connections_needing_attention: number | null;
}>;

/**
 * Reads the overview, or returns null when it cannot be read.
 *
 * Null rather than zeroes, deliberately. A failed query and an empty queue are
 * different facts, and rendering both as "0" reports "nothing needs you" on
 * the strength of a query that never answered - which is the one wrong answer
 * this panel must never give. The caller renders the difference.
 */
export async function loadWorkspaceOverview(
  client: SupabaseClient,
  workspaceId: string
): Promise<WorkspaceOverview | null> {
  const { data, error } = await client
    .from("workspace_overview_view")
    .select(
      "conversations_awaiting_human,handoffs_open,followups_due,connections_needing_attention"
    )
    // RLS already limits the view to workspaces the caller belongs to. This is
    // the second half of the same statement: of those, this one.
    .eq("workspace_id", workspaceId)
    .maybeSingle<OverviewRow>();

  if (error || !data) return null;

  return Object.freeze({
    conversationsAwaitingHuman: data.conversations_awaiting_human ?? 0,
    handoffsOpen: data.handoffs_open ?? 0,
    followupsDue: data.followups_due ?? 0,
    connectionsNeedingAttention: data.connections_needing_attention ?? 0
  });
}
