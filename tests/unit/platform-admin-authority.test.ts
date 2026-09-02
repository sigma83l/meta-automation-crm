import { describe, expect, it, vi } from "vitest";

import {
  capabilitiesFor,
  platformAdminRoles,
  platformCapabilities,
  roleAllows,
  IMPERSONATION_MAX_MINUTES,
  type PlatformAdminRole
} from "@/src/modules/platform-admin/contracts";
import { featureKeys } from "@/src/modules/features/contracts";
import {
  assertPlatformCapability,
  PlatformAdminError,
  resolvePlatformAdmin
} from "@/src/modules/platform-admin/server/runtime";

/**
 * The console's authority rules, tested away from the database.
 *
 * The migration test proves the engine refuses the wrong session. This proves
 * the layer above it refuses the wrong *role* — which is the half a correct
 * policy cannot express, because to Postgres every active staff member looks
 * identical.
 */

const admin = (role: PlatformAdminRole) => Object.freeze({ userId: "u1", role });

describe("staff capabilities", () => {
  it("gives support reading and viewing, and nothing that changes a customer", () => {
    const support = capabilitiesFor("platform_support");
    expect(support).toContain("read");
    expect(support).toContain("impersonate");
    for (const capability of ["lifecycle", "billing", "features", "operations", "staff"] as const) {
      expect(support).not.toContain(capability);
    }
  });

  it("withholds staff granting from everyone but the owner", () => {
    // The escalation that matters: an admin who could grant would be able to
    // promote themselves to owner, which makes the distinction decorative.
    expect(roleAllows("platform_admin", "staff")).toBe(false);
    expect(roleAllows("platform_support", "staff")).toBe(false);
    expect(roleAllows("platform_owner", "staff")).toBe(true);
  });

  it("keeps every role's capabilities a subset of the owner's", () => {
    const owner = capabilitiesFor("platform_owner");
    for (const role of platformAdminRoles) {
      for (const capability of capabilitiesFor(role)) {
        expect(owner).toContain(capability);
      }
    }
  });

  it("names a capability that no role holds nowhere in the list", () => {
    // Guards against a capability being added to the union and then silently
    // held by nobody, which reads at a call site as "this is locked down" when
    // it actually means the action is unreachable.
    for (const capability of platformCapabilities) {
      expect(platformAdminRoles.some((role) => roleAllows(role, capability))).toBe(true);
    }
  });

  it("throws FORBIDDEN rather than passing when a role falls short", () => {
    expect(() => assertPlatformCapability(admin("platform_support"), "lifecycle")).toThrow(
      PlatformAdminError
    );
    try {
      assertPlatformCapability(admin("platform_admin"), "staff");
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as PlatformAdminError).reason).toBe("FORBIDDEN");
    }
    expect(() => assertPlatformCapability(admin("platform_owner"), "staff")).not.toThrow();
  });
});

describe("resolvePlatformAdmin", () => {
  const clientReturning = (data: unknown, error: unknown = null) =>
    ({ rpc: vi.fn().mockResolvedValue({ data, error }) }) as never;

  it("accepts an active staff row", async () => {
    const resolved = await resolvePlatformAdmin(
      clientReturning([
        { admin_user_id: "u1", admin_role: "platform_admin", admin_status: "active" }
      ])
    );
    expect(resolved).toEqual({ userId: "u1", role: "platform_admin" });
  });

  it("refuses an empty answer, an error, and a malformed row alike", async () => {
    for (const client of [
      clientReturning([]),
      clientReturning(null),
      clientReturning(null, { message: "boom" }),
      clientReturning([{ admin_user_id: "u1" }]),
      clientReturning([{ admin_role: "platform_owner" }])
    ]) {
      await expect(resolvePlatformAdmin(client)).rejects.toThrow(PlatformAdminError);
    }
  });

  it("refuses a role this build does not know", async () => {
    // A database mid-deploy can hold an enum value this bundle has never heard
    // of. Failing closed makes that narrow access rather than widen it.
    await expect(
      resolvePlatformAdmin(
        clientReturning([
          { admin_user_id: "u1", admin_role: "platform_god", admin_status: "active" }
        ])
      )
    ).rejects.toThrow(PlatformAdminError);
  });

  it("reports NOT_STAFF, never FORBIDDEN, for a non-staff session", async () => {
    // The two reasons map to different HTTP statuses — 404 and 403 — and only
    // the first keeps the console's shape hidden from a probing customer.
    try {
      await resolvePlatformAdmin(clientReturning([]));
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as PlatformAdminError).reason).toBe("NOT_STAFF");
    }
  });
});

describe("bounds", () => {
  it("keeps an impersonation window under an hour", () => {
    expect(IMPERSONATION_MAX_MINUTES).toBeLessThanOrEqual(60);
    expect(IMPERSONATION_MAX_MINUTES).toBeGreaterThan(0);
  });

  it("keeps the feature key union and the seeded catalogue in step", async () => {
    // The union is what the application gates on and the catalogue is what the
    // console shows. A key in one and not the other is a gate that silently
    // reads false forever, or a switch that changes nothing.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../../supabase/migrations/20260902120000_platform_admin_console.sql",
          import.meta.url
        )
      ),
      "utf8"
    );
    const seeded = [...migration.matchAll(/^\s*\('([a-z_]+)',\s*'/gm)].map((match) => match[1]);
    for (const key of featureKeys) {
      expect(seeded).toContain(key);
    }
  });
});
