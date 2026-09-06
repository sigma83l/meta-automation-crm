import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Makes a verified provider event visible in the CRM.
 *
 * The work is in `project_meta_message`, not here, because the four writes it
 * performs have to be one transaction. What this adds is the boundary: the
 * database returns an untyped row, and everything past this point deals in a
 * named outcome rather than a string nobody checked.
 *
 * The outcomes are deliberately not collapsed into ok/failed. Only `projected`
 * carries a new message, and a caller that runs a turn for `duplicate` or
 * `status_applied` would answer the same customer twice.
 */

export const PROJECTION_RESULTS = [
  /** A new inbound message now exists. The only outcome a turn follows. */
  "projected",
  /** Already projected. A replayed relay or a retried step. */
  "duplicate",
  /** A receipt updated the message it named. */
  "status_applied",
  /** A receipt for a message this workspace does not have. */
  "status_unmatched",
  /** A receipt that named no message at all. */
  "no_message_ref",
  /** A comment or private reply: recorded, not a direct-message thread. */
  "skipped",
  /** A message with no sender, which cannot be attributed to anyone. */
  "no_sender",
  /** No such event in this workspace. */
  "not_found"
] as const;

export type ProjectionResult = (typeof PROJECTION_RESULTS)[number];

export type ProjectedMessage = Readonly<{
  result: ProjectionResult;
  customerId?: string;
  conversationId?: string;
  messageId?: string;
}>;

type ProjectionRow = Readonly<{
  result: string;
  customer_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
}>;

function isProjectionResult(value: string): value is ProjectionResult {
  return (PROJECTION_RESULTS as readonly string[]).includes(value);
}

/**
 * `trustedWorkspaceId` must come from the routing record the ingest function
 * resolved from the stored connection — never from a payload. It is passed
 * rather than inferred so that a caller holding the wrong tenant gets
 * `not_found` instead of writing into it.
 */
export async function projectMetaMessage(
  admin: SupabaseClient,
  webhookEventId: string,
  trustedWorkspaceId: string
): Promise<ProjectedMessage> {
  const { data, error } = await admin.rpc("project_meta_message", {
    p_webhook_event_id: webhookEventId,
    p_workspace_id: trustedWorkspaceId
  });
  if (error) throw new Error("MESSAGE_PROJECTION_FAILED");

  const row = (data as ProjectionRow[] | null)?.[0];
  // An empty result set is not a silent success. The function returns a row on
  // every path, so nothing coming back means it did not run as written.
  if (!row || !isProjectionResult(row.result)) throw new Error("MESSAGE_PROJECTION_FAILED");

  return Object.freeze({
    result: row.result,
    ...(row.customer_id ? { customerId: row.customer_id } : {}),
    ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
    ...(row.message_id ? { messageId: row.message_id } : {})
  });
}
