import "server-only";

import type { FeatureFlagState } from "../contracts";
import { recordPlatformAudit } from "./audit";
import { assertPlatformCapability, type PlatformAdminRuntime } from "./runtime";

type CatalogueRow = Readonly<{
  key: string;
  display_name: string;
  description: string;
  default_enabled: boolean;
  archived: boolean;
}>;

export async function loadFlagCatalogue(
  runtime: PlatformAdminRuntime
): Promise<readonly CatalogueRow[]> {
  const { data, error } = await runtime.db
    .from("feature_flags")
    .select("key,display_name,description,default_enabled,archived")
    .eq("archived", false)
    .order("key");
  if (error) throw new Error("Feature catalogue read failed.");
  return (data ?? []) as CatalogueRow[];
}

/**
 * One workspace's flags, resolved by the database rather than here.
 *
 * `workspace_feature_flags()` already applies override → plan → default and
 * reports which layer won. Recomputing that precedence in TypeScript would give
 * the console a second opinion, and the screen showing "on" while the gate says
 * "off" is the exact confusion a flag system exists to avoid.
 */
export async function loadWorkspaceFlagStates(
  runtime: PlatformAdminRuntime,
  workspaceId: string
): Promise<readonly FeatureFlagState[]> {
  const [catalogue, resolved, overrides] = await Promise.all([
    loadFlagCatalogue(runtime),
    runtime.db.rpc("workspace_feature_flags", { target_workspace_id: workspaceId }),
    runtime.db
      .from("workspace_feature_overrides")
      .select("flag_key,reason,expires_at")
      .eq("workspace_id", workspaceId)
  ]);
  if (resolved.error) throw new Error("Feature flag resolution failed.");

  const resolvedByKey = new Map(
    ((resolved.data ?? []) as { flag_key: string; enabled: boolean; source: string }[]).map(
      (row) => [row.flag_key, row]
    )
  );
  const overrideByKey = new Map(
    (
      (overrides.data ?? []) as { flag_key: string; reason: string; expires_at: string | null }[]
    ).map((row) => [row.flag_key, row])
  );

  return catalogue.map((entry) => {
    const state = resolvedByKey.get(entry.key);
    const override = overrideByKey.get(entry.key);
    return {
      key: entry.key,
      displayName: entry.display_name,
      description: entry.description,
      enabled: state?.enabled ?? entry.default_enabled,
      source: (state?.source ?? "default") as FeatureFlagState["source"],
      overrideReason: override?.reason ?? null,
      overrideExpiresAt: override?.expires_at ?? null
    };
  });
}

const MAX_OVERRIDE_DAYS = 365;

export async function setWorkspaceFeatureOverride(
  runtime: PlatformAdminRuntime,
  input: Readonly<{
    workspaceId: string;
    flagKey: string;
    enabled: boolean;
    reason: string;
    expiresInDays?: number;
  }>
) {
  assertPlatformCapability(runtime.admin, "features");
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 400) {
    throw new Error("An override needs a reason between 3 and 400 characters.");
  }
  // Bounded here rather than in the check constraint: the column stores an
  // instant, and a constraint on `now()` would not be immutable.
  const days = input.expiresInDays;
  if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > MAX_OVERRIDE_DAYS)) {
    throw new Error(`An override expiry must be 1 to ${MAX_OVERRIDE_DAYS} days.`);
  }
  const expiresAt =
    days === undefined ? null : new Date(Date.now() + days * 86_400_000).toISOString();

  const { error } = await runtime.db.from("workspace_feature_overrides").upsert(
    {
      workspace_id: input.workspaceId,
      flag_key: input.flagKey,
      enabled: input.enabled,
      reason,
      set_by: runtime.admin.userId,
      expires_at: expiresAt,
      updated_at: new Date().toISOString()
    },
    { onConflict: "workspace_id,flag_key" }
  );
  if (error) throw new Error("Feature override write failed.");

  await recordPlatformAudit(runtime, {
    action: "feature.override_set",
    targetWorkspaceId: input.workspaceId,
    safeDetails: {
      flag_key: input.flagKey,
      enabled: input.enabled,
      reason,
      expires_at: expiresAt
    }
  });
}

export async function clearWorkspaceFeatureOverride(
  runtime: PlatformAdminRuntime,
  input: Readonly<{ workspaceId: string; flagKey: string }>
) {
  assertPlatformCapability(runtime.admin, "features");
  const { error } = await runtime.db
    .from("workspace_feature_overrides")
    .delete()
    .eq("workspace_id", input.workspaceId)
    .eq("flag_key", input.flagKey);
  if (error) throw new Error("Feature override removal failed.");
  await recordPlatformAudit(runtime, {
    action: "feature.override_cleared",
    targetWorkspaceId: input.workspaceId,
    safeDetails: { flag_key: input.flagKey }
  });
}

export async function setPlanFeatureDefault(
  runtime: PlatformAdminRuntime,
  input: Readonly<{ planId: string; flagKey: string; enabled: boolean }>
) {
  assertPlatformCapability(runtime.admin, "features");
  const { error } = await runtime.db.from("plan_feature_defaults").upsert(
    {
      plan_id: input.planId,
      flag_key: input.flagKey,
      enabled: input.enabled,
      updated_by: runtime.admin.userId,
      updated_at: new Date().toISOString()
    },
    { onConflict: "plan_id,flag_key" }
  );
  if (error) throw new Error("Plan default write failed.");
  await recordPlatformAudit(runtime, {
    action: "feature.plan_default_set",
    safeDetails: { plan_id: input.planId, flag_key: input.flagKey, enabled: input.enabled }
  });
}

/**
 * Retire a capability everywhere at once.
 *
 * Archiving beats every override and plan default by construction — see
 * `workspace_feature_enabled` — so this is the one action that needs no sweep
 * of the override table to be complete.
 */
export async function setFlagArchived(
  runtime: PlatformAdminRuntime,
  input: Readonly<{ flagKey: string; archived: boolean }>
) {
  assertPlatformCapability(runtime.admin, "features");
  const { error } = await runtime.db
    .from("feature_flags")
    .update({ archived: input.archived, updated_at: new Date().toISOString() })
    .eq("key", input.flagKey);
  if (error) throw new Error("Feature catalogue write failed.");
  await recordPlatformAudit(runtime, {
    action: input.archived ? "feature.archived" : "feature.restored",
    safeDetails: { flag_key: input.flagKey }
  });
}

export async function loadPlanDefaults(runtime: PlatformAdminRuntime) {
  const [plans, defaults] = await Promise.all([
    runtime.db
      .from("subscription_plans")
      .select("id,plan_key,display_name,active")
      .order("price_minor_units"),
    runtime.db.from("plan_feature_defaults").select("plan_id,flag_key,enabled")
  ]);
  if (plans.error) throw new Error("Plan read failed.");
  const enabledByPlan = new Map<string, Map<string, boolean>>();
  for (const row of defaults.data ?? []) {
    const planId = String(row.plan_id);
    if (!enabledByPlan.has(planId)) enabledByPlan.set(planId, new Map());
    enabledByPlan.get(planId)!.set(String(row.flag_key), Boolean(row.enabled));
  }
  return (plans.data ?? []).map((plan) => ({
    id: plan.id as string,
    planKey: plan.plan_key as string,
    displayName: plan.display_name as string,
    active: plan.active as boolean,
    defaults: Object.fromEntries(enabledByPlan.get(plan.id as string) ?? new Map())
  }));
}
