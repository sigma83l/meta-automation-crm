import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createFakeSupabase, type FakeRow } from "@/tests/fixtures/fake-supabase";
import type { PlatformAdminRole } from "@/src/modules/platform-admin/contracts";
import {
  recordPlatformAudit,
  recordWorkspaceView
} from "@/src/modules/platform-admin/server/audit";
import { extendTrial } from "@/src/modules/platform-admin/server/billing-overrides";
import { setWorkspaceFeatureOverride } from "@/src/modules/platform-admin/server/feature-flags";
import {
  closeImpersonationGrant,
  openImpersonation
} from "@/src/modules/platform-admin/server/impersonation";
import { setMembershipRole, setUserStatus } from "@/src/modules/platform-admin/server/lifecycle";
import { setSwitch } from "@/src/modules/platform-admin/server/switches";
import { requeueOutboxEvent } from "@/src/modules/platform-admin/server/ops";
import { maskedEmailsFor, searchUsersByEmail } from "@/src/modules/platform-admin/server/directory";
import { OUTBOX_ATTEMPT_CEILING, OUTBOX_RETRY_GRANT } from "@/src/lib/inngest/outbox-policy";
import { revokeStaff, setStaffRole } from "@/src/modules/platform-admin/server/staff";
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

describe("staff role changes", () => {
  /**
   * The gap this closes: revocation refused to remove the last owner, but a role
   * change reached the same dead end and did not check. The staff table renders
   * "Change role" on every row including your own, so the last owner was one
   * form submission from an installation nobody can administer — recoverable
   * only by rerunning the bootstrap script with the service-role key.
   */
  it("refuses to demote the last active owner, including the caller", async () => {
    const { runtime, database } = runtimeWith({
      profiles: [{ id: "staff-1", workspace_id: "w1" }],
      platform_admins: [{ user_id: "staff-1", role: "platform_owner", status: "active" }]
    });
    await expect(
      setStaffRole(runtime, {
        userId: "staff-1",
        role: "platform_support",
        reason: "stepping back"
      })
    ).rejects.toThrow(/platform owner/);
    expect(database.rows("platform_admins")[0]!.role).toBe("platform_owner");
    expect(ledger(database)).toHaveLength(0);
  });

  it("allows the demotion once a second owner exists", async () => {
    const { runtime, database } = runtimeWith({
      profiles: [{ id: "staff-1", workspace_id: "w1" }],
      platform_admins: [
        { user_id: "staff-1", role: "platform_owner", status: "active" },
        { user_id: "staff-2", role: "platform_owner", status: "active" }
      ]
    });
    await setStaffRole(runtime, {
      userId: "staff-1",
      role: "platform_support",
      reason: "handing over"
    });
    const rows = database.rows("platform_admins");
    expect(rows.find((row) => row.user_id === "staff-1")!.role).toBe("platform_support");
    // A change, not a first grant, and the ledger says which.
    expect(ledger(database)[0]!.action).toBe("staff.role_changed");
    expect(ledger(database)[0]!.safe_details).toMatchObject({
      previous_role: "platform_owner",
      role: "platform_support"
    });
  });

  it("refuses to bring a revoked account back as a side effect of a role edit", async () => {
    const { runtime, database } = runtimeWith({
      profiles: [{ id: "staff-2", workspace_id: "w1" }],
      platform_admins: [
        { user_id: "staff-1", role: "platform_owner", status: "active" },
        { user_id: "staff-2", role: "platform_admin", status: "disabled" }
      ]
    });
    await expect(
      setStaffRole(runtime, { userId: "staff-2", role: "platform_admin", reason: "tidying up" })
    ).rejects.toThrow(/revoked/);
    expect(database.rows("platform_admins").find((row) => row.user_id === "staff-2")!.status).toBe(
      "disabled"
    );
  });

  it("reinstates when that is what was asked for, and says so in the ledger", async () => {
    const { runtime, database } = runtimeWith({
      profiles: [{ id: "staff-2", workspace_id: "w1" }],
      platform_admins: [
        { user_id: "staff-1", role: "platform_owner", status: "active" },
        { user_id: "staff-2", role: "platform_admin", status: "disabled" }
      ]
    });
    await setStaffRole(runtime, {
      userId: "staff-2",
      role: "platform_support",
      reason: "back from leave",
      reinstate: true
    });
    const row = database.rows("platform_admins").find((entry) => entry.user_id === "staff-2")!;
    expect(row.status).toBe("active");
    expect(row.role).toBe("platform_support");
    expect(ledger(database)[0]!.action).toBe("staff.reinstated");
  });

  it("still refuses a role this build does not know", async () => {
    const { runtime } = runtimeWith({
      profiles: [{ id: "staff-2", workspace_id: "w1" }],
      platform_admins: [{ user_id: "staff-1", role: "platform_owner", status: "active" }]
    });
    await expect(
      setStaffRole(runtime, {
        userId: "staff-2",
        role: "platform_root" as PlatformAdminRole,
        reason: "typo"
      })
    ).rejects.toThrow(/Unknown staff role/);
  });

  it("refuses a caller who is not an owner", async () => {
    const { runtime } = runtimeWith(
      {
        profiles: [{ id: "staff-2", workspace_id: "w1" }],
        platform_admins: [{ user_id: "staff-1", role: "platform_admin", status: "active" }]
      },
      "platform_admin"
    );
    await expect(
      setStaffRole(runtime, { userId: "staff-2", role: "platform_owner", reason: "promotion" })
    ).rejects.toBeInstanceOf(PlatformAdminError);
  });
});

describe("closing a viewing window", () => {
  const openGrant = (adminId: string) => ({
    id: "grant-1",
    admin_id: adminId,
    workspace_id: "ws-1",
    reason: "customer reported a missing report",
    expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
    revoked_at: null
  });

  it("lets the holder close their own", async () => {
    const { runtime, database } = runtimeWith({
      platform_impersonation_grants: [openGrant("staff-1")]
    });
    await closeImpersonationGrant(runtime, "grant-1");
    expect(database.rows("platform_impersonation_grants")[0]!.revoked_at).not.toBeNull();
    expect(ledger(database)[0]!.safe_details).toMatchObject({ closed_own_grant: true });
  });

  /**
   * The gap: every close was scoped to the caller's own `admin_id`, so the
   * overview showed an owner a live window into a customer that only the person
   * inside it could end.
   */
  it("lets an owner close somebody else's", async () => {
    const { runtime, database } = runtimeWith({
      platform_impersonation_grants: [openGrant("staff-2")]
    });
    await closeImpersonationGrant(runtime, "grant-1");
    expect(database.rows("platform_impersonation_grants")[0]!.revoked_at).not.toBeNull();
    const line = ledger(database)[0]!;
    expect(line.actor_id).toBe("staff-1");
    // The holder, so the ledger records both halves of who did what to whom.
    expect(line.target_user_id).toBe("staff-2");
    expect(line.safe_details).toMatchObject({ closed_own_grant: false });
  });

  it("refuses a support role reaching for a colleague's window", async () => {
    const { runtime, database } = runtimeWith(
      { platform_impersonation_grants: [openGrant("staff-2")] },
      "platform_support"
    );
    await expect(closeImpersonationGrant(runtime, "grant-1")).rejects.toBeInstanceOf(
      PlatformAdminError
    );
    expect(database.rows("platform_impersonation_grants")[0]!.revoked_at).toBeNull();
  });

  it("still lets a support role close their own", async () => {
    const { runtime, database } = runtimeWith(
      { platform_impersonation_grants: [openGrant("staff-1")] },
      "platform_support"
    );
    await closeImpersonationGrant(runtime, "grant-1");
    expect(database.rows("platform_impersonation_grants")[0]!.revoked_at).not.toBeNull();
  });

  it("says so rather than reporting a close that did nothing", async () => {
    const { runtime } = runtimeWith({ platform_impersonation_grants: [] });
    await expect(closeImpersonationGrant(runtime, "grant-1")).rejects.toThrow(/not open/);
  });
});

describe("recording that a customer's workspace was read", () => {
  /**
   * The ledger recorded every mutation and no reads, so the question it could
   * not answer was the one an affected customer asks first. Impersonation
   * grants looked like the answer and were not: they gate nothing, so a staff
   * member who never opened one left no trace at all.
   */
  it("writes a line naming the actor and the workspace", async () => {
    const { runtime, database } = runtimeWith({ platform_admin_audit_events: [] });
    await recordWorkspaceView(runtime, "ws-1");
    const row = ledger(database)[0]!;
    expect(row.action).toBe("workspace.viewed");
    expect(row.actor_id).toBe("staff-1");
    expect(row.target_workspace_id).toBe("ws-1");
  });

  it("collapses one sitting into one line", async () => {
    const { runtime, database } = runtimeWith({ platform_admin_audit_events: [] });
    await recordWorkspaceView(runtime, "ws-1");
    await recordWorkspaceView(runtime, "ws-1");
    await recordWorkspaceView(runtime, "ws-1");
    expect(ledger(database)).toHaveLength(1);
  });

  it("writes again for a different workspace, and for a different reader", async () => {
    const { runtime, database } = runtimeWith({ platform_admin_audit_events: [] });
    await recordWorkspaceView(runtime, "ws-1");
    await recordWorkspaceView(runtime, "ws-2");
    expect(ledger(database)).toHaveLength(2);

    const second: PlatformAdminRuntime = Object.freeze({
      ...runtime,
      admin: Object.freeze({ userId: "staff-9", role: "platform_support" as PlatformAdminRole })
    });
    await recordWorkspaceView(second, "ws-1");
    expect(ledger(database)).toHaveLength(3);
  });

  it("writes again once the window has passed", async () => {
    const { runtime, database } = runtimeWith({
      platform_admin_audit_events: [
        {
          id: 1,
          actor_id: "staff-1",
          action: "workspace.viewed",
          target_workspace_id: "ws-1",
          occurred_at: new Date(Date.now() - 60 * 60_000).toISOString()
        }
      ]
    });
    await recordWorkspaceView(runtime, "ws-1");
    // A visit an hour later is a separate visit, and the ledger should say so.
    expect(ledger(database)).toHaveLength(2);
  });
});

describe("looking an account up by address", () => {
  /**
   * Builds a fake GoTrue directory that pages the way the real one does.
   *
   * The bug this covers made no noise: both callers read page one and stopped,
   * so an account past that page came back as "no such account" and a masked
   * email column quietly became an em dash. Neither is an error state anybody
   * would notice from the outside, which is why the paging is asserted here.
   */
  function directoryOf(count: number, options: Readonly<{ pageSize?: number }> = {}) {
    const pageSize = options.pageSize ?? 1000;
    const users = Array.from({ length: count }, (_, index) => ({
      id: `user-${index}`,
      email: `person${index}@example.test`
    }));
    const listUsers = vi.fn(({ page, perPage }: { page: number; perPage: number }) => {
      const size = Math.min(perPage, pageSize);
      const start = (page - 1) * size;
      return Promise.resolve({ data: { users: users.slice(start, start + size) }, error: null });
    });
    return { users, listUsers };
  }

  function runtimeWithDirectory(
    listUsers: ReturnType<typeof directoryOf>["listUsers"],
    tables: Readonly<Record<string, readonly FakeRow[]>> = {}
  ) {
    const { runtime } = runtimeWith(tables);
    const db = runtime.db as unknown as { auth: { admin: Record<string, unknown> } };
    db.auth.admin.listUsers = listUsers;
    return runtime;
  }

  it("finds an account that sits past the first page", async () => {
    const { listUsers } = directoryOf(2400);
    const runtime = runtimeWithDirectory(listUsers, {
      profiles: [{ id: "user-2300", display_name: "Late joiner", workspace_id: "ws-1" }],
      workspaces: [{ id: "ws-1", name: "Acme" }],
      workspace_memberships: []
    });
    const found = await searchUsersByEmail(runtime, "person2300@example.test");
    expect(found.map((row) => row.userId)).toEqual(["user-2300"]);
    expect(listUsers.mock.calls.length).toBeGreaterThan(1);
  });

  it("stops at the last page instead of asking for pages that are not there", async () => {
    const { listUsers } = directoryOf(1500);
    const runtime = runtimeWithDirectory(listUsers, { profiles: [] });
    await searchUsersByEmail(runtime, "nobody@example.test");
    // Two full-sized reads cover 1500 accounts; the second comes back short and
    // ends the walk.
    expect(listUsers).toHaveBeenCalledTimes(2);
  });

  it("refuses rather than reporting an empty directory it never finished reading", async () => {
    // 50 pages of 1000 is the ceiling; this directory is larger, so a scan that
    // matched nothing has not proved the address is absent.
    const { listUsers } = directoryOf(60_000);
    const runtime = runtimeWithDirectory(listUsers, { profiles: [] });
    await expect(searchUsersByEmail(runtime, "person59999@example.test")).rejects.toThrow(
      /too many accounts/
    );
  });

  it("pages far enough to mask every row on screen, and no further", async () => {
    const { listUsers } = directoryOf(4000);
    const runtime = runtimeWithDirectory(listUsers);
    const masked = await maskedEmailsFor(runtime, ["user-10", "user-2500"]);
    expect(masked["user-2500"]).toBe("p•••@example.test");
    // Found everything it was asked for on page three, so it stopped there
    // rather than walking the remaining thousand accounts.
    expect(listUsers).toHaveBeenCalledTimes(3);
  });
});

describe("outbox retry", () => {
  /**
   * The defect this covers: the relay claims only rows below the attempt
   * ceiling, so a requeue that cleared `emitted_at` and left `attempts` alone
   * moved nothing at all — and the only rows the console surfaced were the ones
   * already past that ceiling. The action reported success and wrote a ledger
   * line for a requeue that had not happened.
   */
  it("brings a stopped row back under the relay's ceiling", async () => {
    const { runtime, database } = runtimeWith({
      provider_event_outbox: [{ id: "evt-1", workspace_id: "ws-1", attempts: 12, emitted_at: null }]
    });
    await requeueOutboxEvent(runtime, { id: "evt-1", reason: "provider recovered" });

    const row = database.rows("provider_event_outbox")[0]!;
    expect(row.emitted_at).toBeNull();
    expect(Number(row.attempts)).toBeLessThan(OUTBOX_ATTEMPT_CEILING);
    // Bounded, not reset: a permanently failing row gets a few more tries and
    // then stops again, rather than looping forever.
    expect(Number(row.attempts)).toBe(OUTBOX_ATTEMPT_CEILING - OUTBOX_RETRY_GRANT);

    expect(ledger(database)[0]!.action).toBe("ops.outbox_requeued");
    expect(ledger(database)[0]!.safe_details).toMatchObject({ attempts_was: 12, attempts: 7 });
  });

  it("never spends a row's remaining attempts on its behalf", async () => {
    // A row that has failed twice still has eight tries left. Cutting it down to
    // the retry grant would make the button that was meant to help it a demotion.
    const { runtime, database } = runtimeWith({
      provider_event_outbox: [
        { id: "evt-2", workspace_id: "ws-1", attempts: 2, emitted_at: "2026-09-01T00:00:00.000Z" }
      ]
    });
    await requeueOutboxEvent(runtime, { id: "evt-2", reason: "wrongly marked emitted" });
    const row = database.rows("provider_event_outbox")[0]!;
    expect(Number(row.attempts)).toBe(2);
    expect(row.emitted_at).toBeNull();
  });

  it("refuses an id that is not there rather than reporting a requeue", async () => {
    const { runtime, database } = runtimeWith({ provider_event_outbox: [] });
    await expect(
      requeueOutboxEvent(runtime, { id: "missing", reason: "chasing a ghost" })
    ).rejects.toThrow(/Unknown outbox event/);
    expect(ledger(database)).toHaveLength(0);
  });

  it("refuses a role without operations authority", async () => {
    const { runtime } = runtimeWith(
      { provider_event_outbox: [{ id: "evt-3", workspace_id: "ws-1", attempts: 11 }] },
      "platform_support"
    );
    await expect(
      requeueOutboxEvent(runtime, { id: "evt-3", reason: "support poking at it" })
    ).rejects.toBeInstanceOf(PlatformAdminError);
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
