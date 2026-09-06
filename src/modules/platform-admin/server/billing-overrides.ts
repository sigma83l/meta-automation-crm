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
    .select("status,plan_id,trial_ends_at,current_period_ends_at")
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (!current) throw new Error("Workspace has no subscription record.");

  const { data, error } = await runtime.db.rpc("transition_workspace_subscription", {
    trusted_workspace_id: input.workspaceId,
    trusted_new_status: input.status,
    trusted_plan_id: input.planId ?? null,
    // Carried through, not nulled. This used to pass null, which meant
    // suspending a workspace inside its trial erased the deadline — and since
    // 'trialing' is unreachable once `trial_consumed_at` is set, the restore
    // that was supposed to undo the suspension could never put it back. Every
    // other caller of this function (the renewal cron included) passes the row's
    // own value through; the console was the one that did not. The column is
    // only ever read while the status is 'trialing', so preserving it changes
    // nothing for a workspace that genuinely converts.
    trusted_trial_ends_at: (current.trial_ends_at as string | null) ?? null,
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

/**
 * Move a workspace onto a different plan without changing its status.
 *
 * Through `platform_set_workspace_plan`, which moves `plan_id` and nothing
 * else. This used to express the plan change as a transition to the status the
 * workspace was already in, so that the state machine would carry the new plan
 * along — and that failed for every trialing workspace, because
 * 'trialing' -> 'trialing' is an illegal transition and `trial_consumed_at` is
 * already set. Since a workspace is provisioned into 'trialing', that was every
 * customer who had not yet converted.
 *
 * A plan change is not a status transition, so it no longer pretends to be one.
 * The state machine still owns status, both trial columns and every deadline;
 * none of them are reachable from here.
 */
export async function setWorkspacePlan(
  runtime: PlatformAdminRuntime,
  input: Readonly<{ workspaceId: string; planId: string; reason: string }>
) {
  assertPlatformCapability(runtime.admin, "billing");
  const reason = requireReason(input.reason);

  const [{ data: current }, { data: plan }] = await Promise.all([
    runtime.db
      .from("workspace_subscriptions")
      .select("status,plan_id")
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
  if (plan.active !== true) throw new Error("That plan is retired and cannot be assigned.");

  const { data, error } = await runtime.db.rpc("platform_set_workspace_plan", {
    trusted_workspace_id: input.workspaceId,
    trusted_plan_id: input.planId
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

/**
 * Put back a trial that a status change interrupted.
 *
 * The companion to the deadline no longer being erased by `setSubscriptionStatus`:
 * a workspace suspended mid-trial and then restored used to land on 'active'
 * with its trial gone and no route back, because 'trialing' is unreachable once
 * `trial_consumed_at` is set. `platform_resume_trial` owns the conditions — the
 * trial must be consumed, its deadline must still be in the future, and the
 * deadline does not move — so this cannot grant a trial or lengthen one.
 */
export async function resumeTrial(
  runtime: PlatformAdminRuntime,
  input: Readonly<{ workspaceId: string; reason: string }>
) {
  assertPlatformCapability(runtime.admin, "billing");
  const reason = requireReason(input.reason);

  const { data: current } = await runtime.db
    .from("workspace_subscriptions")
    .select("status,trial_ends_at")
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (!current) throw new Error("Workspace has no subscription record.");

  const { data, error } = await runtime.db.rpc("platform_resume_trial", {
    trusted_workspace_id: input.workspaceId
  });
  // The function's refusals name the actual condition ("the trial deadline has
  // passed and cannot be resumed"), and those sentences are written for staff,
  // so they are surfaced rather than replaced with a generic failure.
  if (error) throw new Error(error.message || "Trial could not be resumed.");
  if (data !== true) throw new Error("Trial could not be resumed.");

  await recordPlatformAudit(runtime, {
    action: "billing.trial_resumed",
    targetWorkspaceId: input.workspaceId,
    safeDetails: {
      from: String(current.status),
      ends_at: (current.trial_ends_at as string | null) ?? null,
      reason
    }
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
