import { describe, expect, it } from "vitest";
import {
  assertWorkspaceManager,
  assertWorkspaceOperator,
  type TrustedWorkspace,
  type WorkspaceRole
} from "@/src/modules/workspaces/server/resolve-workspace";

/**
 * Role enforcement at the application layer.
 *
 * The pack requires every role to be exercised at the API and DB layers rather
 * than only hidden in the UI. Before this, `owner` was the only role named
 * anywhere in the suite: nothing proved a viewer could not mutate, or that an
 * operator was kept out of billing and credentials. A regression in either gate
 * would have been invisible.
 *
 * The DB half of the same rule lives in tests/migrations/role-policies.test.ts.
 */

const ROLES: readonly WorkspaceRole[] = ["owner", "admin", "operator", "viewer"];

const as = (role: WorkspaceRole): TrustedWorkspace => ({
  id: "00000000-0000-0000-0000-0000000000ws",
  name: "Acme",
  userId: "00000000-0000-0000-0000-0000000000us",
  role
});

describe("workspace manager gate", () => {
  // Guards billing, provider connections, AI credentials, onboarding writes.
  it.each(["owner", "admin"] as const)("admits %s", (role) => {
    expect(() => assertWorkspaceManager(as(role))).not.toThrow();
  });

  it.each(["operator", "viewer"] as const)("refuses %s", (role) => {
    expect(() => assertWorkspaceManager(as(role))).toThrow(/manager permission/i);
  });
});

describe("workspace operator gate", () => {
  // Guards CRM and automation mutations.
  it.each(["owner", "admin", "operator"] as const)("admits %s", (role) => {
    expect(() => assertWorkspaceOperator(as(role))).not.toThrow();
  });

  it("refuses viewer", () => {
    expect(() => assertWorkspaceOperator(as("viewer"))).toThrow(/operator permission/i);
  });
});

describe("role gate ordering", () => {
  it("never admits a role to management that operation already refuses", () => {
    // Manager must be a strict subset of operator. If that inverts, a role
    // could reach billing while being denied the inbox, which would be a
    // privilege inversion rather than a mere bug.
    for (const role of ROLES) {
      const manager = ((): boolean => {
        try {
          assertWorkspaceManager(as(role));
          return true;
        } catch {
          return false;
        }
      })();
      const operator = ((): boolean => {
        try {
          assertWorkspaceOperator(as(role));
          return true;
        } catch {
          return false;
        }
      })();
      if (manager) expect(`${role}:${operator}`).toBe(`${role}:true`);
    }
  });

  it("grants no authority to an unrecognised role", () => {
    // Defensive: a role added to the enum but not to the gates must fail
    // closed rather than inherit access.
    const rogue = { ...as("owner"), role: "superuser" as WorkspaceRole };
    expect(() => assertWorkspaceManager(rogue)).toThrow();
    expect(() => assertWorkspaceOperator(rogue)).toThrow();
  });
});
