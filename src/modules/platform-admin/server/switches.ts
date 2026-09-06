import "server-only";

import type { PlatformSwitch } from "../contracts";
import { recordPlatformAudit } from "./audit";
import { requireReason } from "./reason";
import { assertPlatformCapability, type PlatformAdminRuntime } from "./runtime";

export async function listSwitches(
  runtime: PlatformAdminRuntime
): Promise<readonly PlatformSwitch[]> {
  const { data, error } = await runtime.db
    .from("platform_switches")
    .select("key,enabled,description,updated_at")
    .order("key");
  if (error) throw new Error("Switch read failed.");
  return (data ?? []).map((row) => ({
    key: row.key as string,
    enabled: row.enabled as boolean,
    description: row.description as string,
    updatedAt: row.updated_at as string
  }));
}

/**
 * Move a global switch.
 *
 * Turning one off is immediate and total. Turning one on restores only the
 * *permission* to proceed: the environment gate, the approval, the recipient
 * allowlist and the provider policy are all still consulted downstream, so this
 * console cannot start a live send by itself no matter which way the switch
 * points. That asymmetry is documented on the table and enforced in
 * `isPlatformSwitchEnabled`, which is the only reader.
 */
export async function setSwitch(
  runtime: PlatformAdminRuntime,
  input: Readonly<{ key: string; enabled: boolean; reason: string }>
) {
  assertPlatformCapability(runtime.admin, "operations");
  const reason = requireReason(input.reason);

  const { data, error } = await runtime.db
    .from("platform_switches")
    .update({
      enabled: input.enabled,
      updated_by: runtime.admin.userId,
      updated_at: new Date().toISOString()
    })
    .eq("key", input.key)
    .select("key");
  if (error || (data ?? []).length === 0) throw new Error("Unknown switch.");

  await recordPlatformAudit(runtime, {
    action: input.enabled ? "switch.enabled" : "switch.disabled",
    safeDetails: { key: input.key, reason }
  });
}
