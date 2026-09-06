import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

import {
  roleAllows,
  platformAdminRoles,
  type PlatformAdmin,
  type PlatformAdminRole,
  type PlatformCapability
} from "../contracts";

/**
 * Refusal from the console, distinguishable from any other failure.
 *
 * `NOT_STAFF` and `FORBIDDEN` are different answers and are kept apart: the
 * first means "this session is not staff at all", the second means "staff, but
 * not for this action". Only the second is worth telling the caller about in
 * detail — see `platformAdminResponse`.
 */
export class PlatformAdminError extends Error {
  constructor(readonly reason: "NOT_STAFF" | "FORBIDDEN") {
    super(reason === "NOT_STAFF" ? "Platform staff access required." : "Insufficient staff role.");
    this.name = "PlatformAdminError";
  }
}

/**
 * Who the caller is, asked of the database as the caller.
 *
 * Deliberately not asked through the service-role client. Resolving staff
 * identity with a credential that already bypasses row security would mean the
 * only thing standing between a signed-in customer and the console is a
 * correctly written `eq()` in application code. Going through
 * `current_platform_admin()` on the user's own session makes the engine answer
 * the question, and a bug in this file returns nobody rather than everybody.
 */
export async function resolvePlatformAdmin(client: SupabaseClient): Promise<PlatformAdmin> {
  const { data, error } = await client.rpc("current_platform_admin");
  const row = Array.isArray(data)
    ? (data[0] as { admin_user_id?: string; admin_role?: string } | undefined)
    : undefined;
  if (error || !row?.admin_user_id || !row.admin_role) {
    throw new PlatformAdminError("NOT_STAFF");
  }
  if (!platformAdminRoles.includes(row.admin_role as PlatformAdminRole)) {
    // A role the database knows and this build does not. Failing closed keeps a
    // half-deployed enum from widening access rather than narrowing it.
    throw new PlatformAdminError("NOT_STAFF");
  }
  return Object.freeze({ userId: row.admin_user_id, role: row.admin_role as PlatformAdminRole });
}

export function assertPlatformCapability(admin: PlatformAdmin, capability: PlatformCapability) {
  if (!roleAllows(admin.role, capability)) throw new PlatformAdminError("FORBIDDEN");
}

export type PlatformAdminRuntime = Readonly<{
  /** The caller's own session. Reads through this obey row security. */
  client: SupabaseClient;
  /**
   * Service role. Cross-tenant by construction, so every use in this module is
   * preceded by an `assertPlatformCapability` call on the same runtime.
   */
  db: SupabaseClient;
  admin: PlatformAdmin;
}>;

/**
 * The single entry point for every console read and write.
 *
 * `AGENTS.md` requires a service-role write to receive a trusted resolved
 * workspace plus an explicit role check. The console has no workspace to
 * resolve — that is what makes it the exception — so it substitutes the
 * strictly analogous pair: a trusted resolved *staff identity* plus an explicit
 * capability check, both established here before `db` is handed out.
 */
export async function createPlatformAdminRuntime(
  capability: PlatformCapability = "read"
): Promise<PlatformAdminRuntime> {
  const client = await createSupabaseServerClient();
  const admin = await resolvePlatformAdmin(client);
  assertPlatformCapability(admin, capability);
  const db = await createSupabaseAdminClient();
  return Object.freeze({ client, db, admin });
}
