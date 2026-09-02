import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createFakeSupabase, type FakeRow } from "@/tests/fixtures/fake-supabase";
import type { PlatformAdminRole } from "@/src/modules/platform-admin/contracts";
import { recordPlatformAudit } from "@/src/modules/platform-admin/server/audit";
import { extendTrial } from "@/src/modules/platform-admin/server/billing-overrides";
import { setWorkspaceFeatureOverride } from "@/src/modules/platform-admin/server/feature-flags";
import { openImpersonation } from "@/src/modules/platform-admin/server/impersonation";
import { setMembershipRole, setUserStatus } from "@/src/modules/platform-admin/server/lifecycle";
import { setSwitch } from "@/src/modules/platform-admin/server/switches";
import { revokeStaff } from "@/src/modules/platform-admin/server/staff";
import {
  PlatformAdminError,
  type PlatformAdminRuntime
} from "@/src/modules/platform-admin/server/runtime";

/**
 * The console's write paths against an in-memory Supabase.
 *
 * These are the rules that live above the database and therefore cannot be
 * proved by the migration test: that a reason is mandatory, that a numeric
 * bound is enforced before the round trip, that an extension anchors to the
 * right instant, that the ledger records what actually happened, and that the
 * guards protecting last-owner states hold.
 */

const signOut = vi.fn().mockResolvedValue({ error: null });

function runtimeWith(
  tables: Readonly<Record<string, readonly FakeRow[]>>,
  role: PlatformAdminRole = "platform_owner",
  rpc: Parameters<typeof createFakeSupabase>[0] extends infer O
    ? O extends { rpc?: infer R }
      ? R
      : never
    : never = undefined as never
) {
  const { database, client } = createFakeSupabase({ tables, ...(rpc ? { rpc } : {}) });
  // The shared fixture models PostgREST, not GoTrue. Session revocation is a
  // real part of what these actions do, so it is stubbed here rather than
  // omitted — a suspension that never ends a session is the bug most worth
  // catching.
  const db = {
    ...(client as unknown as Record<string, unknown>),
    from: client.from.bind(client),
    rpc: client.rpc.bind(client),
    auth: { admin: { signOut, listUsers: vi.fn() } }
  } as unknown as SupabaseClient;

  const runtime: PlatformAdminRuntime = Object.freeze({
    client,
    db,
    admin: Object.freeze({ userId: "staff-1", role })
  });
  return { runtime, database };
}

const ledger = (database: ReturnType<typeof runtimeWith>["database"]) =>
  database.rows("platform_admin_audit_events");

describe("the audit ledger", () => {
  it("records the actor, the action and the target", async () => {
    const { runtime, database } = runtimeWith({});
    await recordPlatformAudit(runtime, {
      action: "test.action",
      targetWorkspaceId: "ws-1",
      safeDetails: { reason: "because", count: 3, flag: true, nothing: null }
    });
    const row = ledger(database)[0]!;
    expect(row.actor_id).toBe("staff-1");
    expect(row.actor_role).toBe("platform_owner");
    expect(row.target_workspace_id).toBe("ws-1");
    expect(row.safe_details).toEqual({
      reason: "because",
      count: 3,
      flag: true,
      nothing: null
    });
  });

  it("truncates a long detail rather than storing it whole", async () => {
    // The column is the one place a caller could quietly persist a customer's
    // message body by spreading a row into it.
    const { runtime, database } = runtimeWith({});
    await recordPlatformAudit(runtime, {
      action: "test.action",
      safeDetails: { reason: "x".repeat(900) }
    });
    const stored = (ledger(database)[0]!.safe_details as Record<string, string>).reason ?? "";
    expect(stored.length).toBeLessThanOrEqual(401);
    expect(stored.endsWith("…")).toBe(true);
  });
});

describe("feature overrides", () => {
  const tables = {
    workspace_feature_overrides: [] as FakeRow[]
  };

  it("refuses an override with no real reason", async () => {
    const { runtime } = runtimeWith(tables);
    await expect(
      setWorkspaceFeatureOverride(runtime, {
        workspaceId: "ws-1",
        flagKey: "crm_import",
        enabled: true,
        reason: "  "
      })
    ).rejects.toThrow(/reason/);
  });

  it("refuses an expiry outside a year", async () => {
    const { runtime } = runtimeWith(tables);
    await expect(
      setWorkspaceFeatureOverride(runtime, {
        workspaceId: "ws-1",
        flagKey: "crm_import",
        enabled: true,
        reason: "pilot",
        expiresInDays: 400
      })
    ).rejects.toThrow(/expiry/);
    await expect(
      setWorkspaceFeatureOverride(runtime, {
        workspaceId: "ws-1",
        flagKey: "crm_import",
        enabled: true,
        reason: "pilot",
        expiresInDays: 0
      })
    ).rejects.toThrow(/expiry/);
  });

  it("stores no expiry when none was asked for", async () => {
    const { runtime, database } = runtimeWith({ workspace_feature_overrides: [] });
    await setWorkspaceFeatureOverride(runtime, {
      workspaceId: "ws-1",
      flagKey: "crm_import",
      enabled: false,
      reason: "customer asked us to turn it off"
    });
    const row = database.rows("workspace_feature_overrides")[0]!;
    expect(row.expires_at).toBeNull();
    expect(row.set_by).toBe("staff-1");
    expect(ledger(database)[0]!.action).toBe("feature.override_set");
  });

  it("refuses a staff role that may not touch features", async () => {
    const { runtime } = runtimeWith({}, "platform_support");
    await expect(
      setWorkspaceFeatureOverride(runtime, {
        workspaceId: "ws-1",
        flagKey: "crm_import",
        enabled: true,
        reason: "pilot customer"
      })
    ).rejects.toThrow(PlatformAdminError);
  });
});

describe("trial extension", () => {
  const rpc = {
    platform_extend_trial: () => ({ data: true, error: null, count: null })
  };

  it("extends from a live deadline, not from now", async () => {
    const trialEndsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const { runtime, database } = runtimeWith(
      {
        workspace_subscriptions: [
          {
            workspace_id: "ws-1",
            status: "trialing",
            trial_ends_at: trialEndsAt,
            grace_ends_at: null
          }
        ]
      },
      "platform_owner",
      rpc as never
    );
    await extendTrial(runtime, { workspaceId: "ws-1", days: 7, reason: "sales pilot" });
    const sent = database.rpcArgs("platform_extend_trial")[0]!;
    const expected = Date.parse(trialEndsAt) + 7 * 86_400_000;
    expect(Date.parse(String(sent.trusted_new_ends_at))).toBe(expected);
  });

  it("extends from now when the deadline has already passed", async () => {
    // Adding days to a date in the past would produce an "extension" that still
    // leaves the trial expired, which is the whole failure this branch avoids.
    const past = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const { runtime, database } = runtimeWith(
      {
        workspace_subscriptions: [
          {
            workspace_id: "ws-1",
            status: "trial_expired_grace",
            trial_ends_at: past,
            grace_ends_at: null
          }
        ]
      },
      "platform_owner",
      rpc as never
    );
    await extendTrial(runtime, { workspaceId: "ws-1", days: 3, reason: "grace window" });
    const sent = database.rpcArgs("platform_extend_trial")[0]!;
    expect(Date.parse(String(sent.trusted_new_ends_at))).toBeGreaterThan(Date.now());
  });

  it("refuses a length outside its bounds before reaching the database", async () => {
    const { runtime, database } = runtimeWith(
      {
        workspace_subscriptions: [
          { workspace_id: "ws-1", status: "trialing", trial_ends_at: null, grace_ends_at: null }
        ]
      },
      "platform_owner",
      rpc as never
    );
    for (const days of [0, 91, 1.5]) {
      await expect(
        extendTrial(runtime, { workspaceId: "ws-1", days, reason: "too long" })
      ).rejects.toThrow(/1 to 90/);
    }
    expect(database.rpcArgs("platform_extend_trial")).toHaveLength(0);
  });
});

describe("account lifecycle", () => {
  it("ends every session when an account is suspended", async () => {
    signOut.mockClear();
    const { runtime, database } = runtimeWith({
      profiles: [{ id: "user-1", workspace_id: "ws-1", status: "active" }]
    });
    await setUserStatus(runtime, {
      userId: "user-1",
      status: "disabled",
      reason: "abuse report"
    });
    expect(database.rows("profiles")[0]!.status).toBe("disabled");
    expect(signOut).toHaveBeenCalledWith("user-1", "global");
    expect(ledger(database)[0]!.action).toBe("user.suspended");
  });

  it("leaves sessions alone when an account is restored", async () => {
    signOut.mockClear();
    const { runtime, database } = runtimeWith({
      profiles: [{ id: "user-1", workspace_id: "ws-1", status: "disabled" }]
    });
    await setUserStatus(runtime, { userId: "user-1", status: "active", reason: "appeal upheld" });
    expect(signOut).not.toHaveBeenCalled();
    expect(ledger(database)[0]!.action).toBe("user.restored");
  });

  it("refuses to demote the last remaining owner", async () => {
    const { runtime, database } = runtimeWith({
      workspace_memberships: [
        { workspace_id: "ws-1", user_id: "user-1", role: "owner", status: "active" }
      ]
    });
    await expect(
      setMembershipRole(runtime, {
        workspaceId: "ws-1",
        userId: "user-1",
        role: "viewer",
        reason: "left the company"
      })
    ).rejects.toThrow(/at least one active owner/);
    expect(database.rows("workspace_memberships")[0]!.role).toBe("owner");
  });

  it("allows the demotion once a second owner exists", async () => {
    const { runtime, database } = runtimeWith({
      workspace_memberships: [
        { workspace_id: "ws-1", user_id: "user-1", role: "owner", status: "active" },
        { workspace_id: "ws-1", user_id: "user-2", role: "owner", status: "active" }
      ]
    });
    await setMembershipRole(runtime, {
      workspaceId: "ws-1",
      userId: "user-1",
      role: "viewer",
      reason: "handed over"
    });
    expect(database.rows("workspace_memberships")[0]!.role).toBe("viewer");
  });

  it("requires a reason for every lifecycle action", async () => {
    const { runtime } = runtimeWith({
      profiles: [{ id: "user-1", workspace_id: "ws-1", status: "active" }]
    });
    await expect(
      setUserStatus(runtime, { userId: "user-1", status: "disabled", reason: "x" })
    ).rejects.toThrow(/reason/);
  });
});

describe("staff revocation", () => {
  it("refuses to remove the last active platform owner", async () => {
    const { runtime, database } = runtimeWith({
      platform_admins: [{ user_id: "staff-1", role: "platform_owner", status: "active" }]
    });
    await expect(revokeStaff(runtime, { userId: "staff-1", reason: "leaving" })).rejects.toThrow(
      /platform owner/
    );
    expect(database.rows("platform_admins")[0]!.status).toBe("active");
  });

  it("disables rather than deletes, so the ledger still resolves the actor", async () => {
    const { runtime, database } = runtimeWith({
      platform_admins: [
        { user_id: "staff-1", role: "platform_owner", status: "active" },
        { user_id: "staff-2", role: "platform_admin", status: "active" }
      ]
    });
    await revokeStaff(runtime, { userId: "staff-2", reason: "role ended" });
    const rows = database.rows("platform_admins");
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.user_id === "staff-2")!.status).toBe("disabled");
  });
});

describe("global switches", () => {
  it("refuses an unknown key instead of writing nothing quietly", async () => {
    const { runtime } = runtimeWith({
      platform_switches: [{ key: "public_signup", enabled: true, description: "d" }]
    });
    await expect(
      setSwitch(runtime, { key: "no_such_switch", enabled: false, reason: "incident" })
    ).rejects.toThrow(/Unknown switch/);
  });

  it("records which way the switch moved", async () => {
    const { runtime, database } = runtimeWith({
      platform_switches: [{ key: "live_provider_send", enabled: true, description: "d" }]
    });
    await setSwitch(runtime, {
      key: "live_provider_send",
      enabled: false,
      reason: "provider incident"
    });
    expect(database.rows("platform_switches")[0]!.enabled).toBe(false);
    expect(ledger(database)[0]!.action).toBe("switch.disabled");
  });

  it("refuses a role without operations authority", async () => {
    const { runtime } = runtimeWith(
      { platform_switches: [{ key: "public_signup", enabled: true, description: "d" }] },
      "platform_support"
    );
    await expect(
      setSwitch(runtime, { key: "public_signup", enabled: false, reason: "incident" })
    ).rejects.toThrow(PlatformAdminError);
  });
});

describe("impersonation", () => {
  it("refuses a thin reason and an out-of-range window", async () => {
    const { runtime } = runtimeWith({ platform_impersonation_grants: [] });
    await expect(
      openImpersonation(runtime, { workspaceId: "ws-1", reason: "look", minutes: 10 })
    ).rejects.toThrow(/reason/);
    await expect(
      openImpersonation(runtime, {
        workspaceId: "ws-1",
        reason: "reproducing a support ticket",
        minutes: 240
      })
    ).rejects.toThrow(/1 to 60/);
  });
});
