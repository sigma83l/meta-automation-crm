import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { FeatureKey, PlatformSwitchKey } from "../contracts";

/**
 * The gate the application asks before offering a capability.
 *
 * Fails closed. A missing flag, an unreachable database, an archived catalogue
 * entry — each returns `false`, because the alternative is that a transient
 * read error hands a workspace a capability its plan never included, and that
 * failure is invisible until it appears on an invoice.
 *
 * Resolution itself happens in `workspace_feature_enabled` rather than here, so
 * the console, the gate and the tests are all reading one implementation of
 * override → plan → default.
 */
export async function isFeatureEnabled(
  client: SupabaseClient,
  workspaceId: string,
  key: FeatureKey
): Promise<boolean> {
  const { data, error } = await client.rpc("workspace_feature_enabled", {
    target_workspace_id: workspaceId,
    target_flag_key: key
  });
  if (error) return false;
  return data === true;
}

export type FeatureMap = Readonly<Partial<Record<FeatureKey, boolean>>>;

/**
 * Every flag for a workspace in one round trip, for a page that gates several
 * sections. Same fail-closed rule: an error yields an empty map, and an absent
 * key reads as off wherever it is consulted.
 */
export async function loadFeatureMap(
  client: SupabaseClient,
  workspaceId: string
): Promise<FeatureMap> {
  const { data, error } = await client.rpc("workspace_feature_flags", {
    target_workspace_id: workspaceId
  });
  if (error) return {};
  const map: Partial<Record<FeatureKey, boolean>> = {};
  for (const row of (data ?? []) as { flag_key: string; enabled: boolean }[]) {
    map[row.flag_key as FeatureKey] = row.enabled === true;
  }
  return Object.freeze(map);
}

/**
 * Whether a global switch currently permits a capability.
 *
 * Deny-only by contract: a `true` here means "the platform is not blocking
 * this", never "this is allowed". Every caller keeps its own gate — the
 * environment check, the approval, the allowlist — and consults this as an
 * additional way to say no. An unreadable switch reads as blocked.
 */
export async function isPlatformSwitchEnabled(
  client: SupabaseClient,
  key: PlatformSwitchKey
): Promise<boolean> {
  const { data, error } = await client
    .from("platform_switches")
    .select("enabled")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return false;
  return data.enabled === true;
}
