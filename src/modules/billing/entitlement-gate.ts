import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveTrustedWorkspace,
  type TrustedWorkspace
} from "@/src/modules/workspaces/server/resolve-workspace";
import { authorizeWorkspaceEntitlement } from "./entitlement";
import type { SubscriptionStatus } from "./contracts";

/**
 * Thrown by resolveEntitledWorkspace when a workspace's trial/subscription
 * does not authorize paid-feature access. Carries the already-resolved
 * workspace and status so callers (pages, routes) can render a specific
 * blocked state instead of falling through to a generic error boundary.
 */
export class BillingEntitlementError extends Error {
  readonly status: SubscriptionStatus;
  readonly workspace: TrustedWorkspace;

  constructor(status: SubscriptionStatus, workspace: TrustedWorkspace) {
    super("An active subscription or trial is required.");
    this.name = "BillingEntitlementError";
    this.status = status;
    this.workspace = workspace;
  }
}

/**
 * Paid-feature runtimes (CRM, automations, inbox, exports, Meta
 * connections, business profile settings) call this instead of
 * resolveTrustedWorkspace so access is denied once a trial expires or a
 * subscription lapses. Billing itself and the dashboard overview
 * intentionally stay on plain resolveTrustedWorkspace so a blocked
 * workspace can still reach /settings/billing to fix payment.
 */
export async function resolveEntitledWorkspace(client: SupabaseClient): Promise<TrustedWorkspace> {
  const workspace = await resolveTrustedWorkspace(client);
  const { data, error } = await client
    .from("workspace_subscriptions")
    .select("status,trial_ends_at")
    .eq("workspace_id", workspace.id)
    .single();
  if (error || !data) throw new Error("Workspace subscription is unavailable.");

  const status = data.status as SubscriptionStatus;
  const authorization = authorizeWorkspaceEntitlement({
    status,
    trialEndsAt: data.trial_ends_at as string | null
  });
  if (!authorization.ok) throw new BillingEntitlementError(status, workspace);

  return workspace;
}
