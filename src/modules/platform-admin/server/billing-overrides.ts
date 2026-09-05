import "server-only";

import { recordPlatformAudit } from "./audit";
import { requireReason } from "./reason";
import { assertPlatformCapability, type PlatformAdminRuntime } from "./runtime";

export const adminReachableStatuses = ["active", "past_due", "suspended", "canceled"] as const;
export type AdminReachableStatus = (typeof adminReachableStatuses)[number];

/**
 * Move a workspace's subscription state.
 *
 * Through `transition_workspace_subscription`, never around it. That function
 * owns the state machine — which transitions are legal, when `trial_consumed_at`
 * is stamped, when `grace_ends_at` is cleared — and a console that wrote the
 * column directly would be a second, quieter state machine that disagrees with
 * the first under exactly the conditions nobody tests.
 *
 * The four statuses offered are the ones the function treats as reachable from
 * any live state. `trialing` and `trial_expired_grace` are deliberately absent:
 * they are earned by the billing flow, and the support need behind wanting them
 * is served by `extendTrial` below.
 */
export async function setSubscriptionStatus(
  runtime: PlatformAdminRuntime,
  input: Readonly<{
    workspaceId: string;
    status: AdminReachableStatus;
    planId?: string | null;
    reason: string;
  }>
) {
  assertPlatformCapability(runtime.admin, "billing");
  const reason = requireReason(input.reason);
  if (!adminReachableStatuses.includes(input.status)) {
    throw new Error("That subscription status cannot be set from the console.");
  }

  const { data: current } = await runtime.db
    .from("workspace_subscriptions")
    .select("status,plan_id,current_period_ends_at")
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (!current) throw new Error("Workspace has no subscription record.");

  const { data, error } = await runtime.db.rpc("transition_workspace_subscription", {
    trusted_workspace_id: input.workspaceId,
    trusted_new_status: input.status,
    trusted_plan_id: input.planId ?? null,
    trusted_trial_ends_at: null,
    trusted_current_period_ends_at: (current.current_period_ends_at as string | null) ?? null
  });
  if (error || data !== true) throw new Error("Subscription transition failed.");

  await recordPlatformAudit(runtime, {
    action: "billing.status_changed",
    targetWorkspaceId: input.workspaceId,
    safeDetails: {
      from: String(current.status),
      to: input.status,
      plan_id: input.planId ?? null,
      reason
    }
  });
}

/** Move a workspace onto a different plan without changing its status. */
export async function setWorkspacePlan(
  runtime: PlatformAdminRuntime,
  input: Readonly<{ workspaceId: string; planId: string; reason: string }>
) {
  assertPlatformCapability(runtime.admin, "billing");
  const reason = requireReason(input.reason);

  const [{ data: current }, { data: plan }] = await Promise.all([
    runtime.db
      .from("workspace_subscriptions")
      .select("status,plan_id,trial_ends_at,current_period_ends_at")
      .eq("workspace_id", input.workspaceId)
      .maybeSingle(),
    runtime.db
      .from("subscription_plans")
      .select("id,plan_key,active")
      .eq("id", input.planId)
      .maybeSingle()
  ]);
  if (!current) throw new Error("Workspace has no subscription record.");
  if (!plan) throw new Error("Unknown plan.");

  const { data, error } = await runtime.db.rpc("transition_workspace_subscription", {
    trusted_workspace_id: input.workspaceId,
    trusted_new_status: String(current.status),
    trusted_plan_id: input.planId,
    trusted_trial_ends_at: (current.trial_ends_at as string | null) ?? null,
    trusted_current_period_ends_at: (current.current_period_ends_at as string | null) ?? null
  });
  if (error || data !== true) throw new Error("Plan change failed.");

  await recordPlatformAudit(runtime, {
    action: "billing.plan_changed",
    targetWorkspaceId: input.workspaceId,
    safeDetails: { plan_key: String(plan.plan_key), reason }
  });
}

const MAX_EXTENSION_DAYS = 90;

/**
 * Push a running trial's deadline out.
 *
 * Delegates to `platform_extend_trial`, which refuses anything that would be a
 * second trial rather than a longer first one. Worth restating because it is
 * the part support will ask about: this cannot reset a consumed trial, and a
 * workspace that has already used one does not get another from this console.
 */
export async function extendTrial(
  runtime: PlatformAdminRuntime,
  input: Readonly<{ workspaceId: string; days: number; reason: string }>
) {
  assertPlatformCapability(runtime.admin, "billing");
  const reason = requireReason(input.reason);
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_EXTENSION_DAYS) {
    throw new Error(`A trial extension must be 1 to ${MAX_EXTENSION_DAYS} days.`);
  }

  const { data: current } = await runtime.db
    .from("workspace_subscriptions")
    .select("trial_ends_at,grace_ends_at,status")
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (!current) throw new Error("Workspace has no subscription record.");

  // Extend from whichever deadline is live, or from now if both have passed —
  // adding days to a date already in the past would produce an "extension" that
  // still leaves the trial expired.
  const anchorSource =
    (current.trial_ends_at as string | null) ?? (current.grace_ends_at as string | null);
  const anchorMs = anchorSource ? Date.parse(anchorSource) : Number.NaN;
  const anchor = Number.isNaN(anchorMs) ? Date.now() : Math.max(anchorMs, Date.now());
  const newEndsAt = new Date(anchor + input.days * 86_400_000).toISOString();

  const { data, error } = await runtime.db.rpc("platform_extend_trial", {
    trusted_workspace_id: input.workspaceId,
    trusted_new_ends_at: newEndsAt
  });
  if (error || data !== true) throw new Error("Trial extension failed.");

  await recordPlatformAudit(runtime, {
    action: "billing.trial_extended",
    targetWorkspaceId: input.workspaceId,
    safeDetails: { days: input.days, new_ends_at: newEndsAt, reason }
  });
}

export async function listPlans(runtime: PlatformAdminRuntime) {
  const { data, error } = await runtime.db
    .from("subscription_plans")
    .select("id,plan_key,display_name,price_minor_units,currency,active")
    .order("price_minor_units");
  if (error) throw new Error("Plan catalogue read failed.");
  return (data ?? []).map((row) => ({
    id: row.id as string,
    planKey: row.plan_key as string,
    displayName: row.display_name as string,
    priceMinorUnits: row.price_minor_units as number,
    currency: row.currency as string,
    active: row.active as boolean
  }));
}
