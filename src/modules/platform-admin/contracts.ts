/**
 * Platform console shapes shared between the server and the UI.
 *
 * Separate from the modules that produce them so a client component can name
 * the shape without importing a `server-only` module to get at it — the same
 * split `src/modules/workspaces/contracts.ts` makes.
 */

export const platformAdminRoles = ["platform_support", "platform_admin", "platform_owner"] as const;
export type PlatformAdminRole = (typeof platformAdminRoles)[number];

/**
 * What each role may do, as one table rather than as conditions scattered
 * through routes. `read` is what every active staff member holds; the rest are
 * the powers worth separating.
 */
export const platformCapabilities = [
  /** See the console at all. */
  "read",
  /** Suspend and restore workspaces and users; force sign-out. */
  "lifecycle",
  /** Change plans, grant trials, move subscription state. */
  "billing",
  /** Move feature flags and plan defaults. */
  "features",
  /** Move global switches and run ops actions. */
  "operations",
  /** Open a read-only impersonation grant. */
  "impersonate",
  /** Grant and revoke staff access. */
  "staff"
] as const;
export type PlatformCapability = (typeof platformCapabilities)[number];

const capabilitiesByRole: Readonly<Record<PlatformAdminRole, readonly PlatformCapability[]>> =
  Object.freeze({
    platform_support: Object.freeze(["read", "impersonate"] as const),
    platform_admin: Object.freeze([
      "read",
      "lifecycle",
      "billing",
      "features",
      "operations",
      "impersonate"
    ] as const),
    platform_owner: Object.freeze([
      "read",
      "lifecycle",
      "billing",
      "features",
      "operations",
      "impersonate",
      "staff"
    ] as const)
  });

export function roleAllows(role: PlatformAdminRole, capability: PlatformCapability): boolean {
  return capabilitiesByRole[role].includes(capability);
}

export function capabilitiesFor(role: PlatformAdminRole): readonly PlatformCapability[] {
  return capabilitiesByRole[role];
}

export type PlatformAdmin = Readonly<{
  userId: string;
  role: PlatformAdminRole;
}>;

export type PlatformOverview = Readonly<{
  workspaces: Readonly<{ total: number; active: number; disabled: number }>;
  users: Readonly<{ total: number; active: number; disabled: number }>;
  subscriptions: Readonly<Record<string, number>>;
  /** Work waiting on a person, in the same spirit as the workspace overview. */
  attention: Readonly<{
    unrecoveredDeadLetters: number;
    connectionsNeedingAttention: number;
    openSupportTickets: number;
    activeImpersonations: number;
  }>;
}>;

export type WorkspaceRow = Readonly<{
  id: string;
  name: string;
  status: "active" | "disabled";
  createdAt: string;
  memberCount: number;
  subscriptionStatus: string | null;
  planKey: string | null;
  trialEndsAt: string | null;
}>;

export type PlatformUserRow = Readonly<{
  userId: string;
  displayName: string | null;
  status: "active" | "disabled";
  workspaceId: string;
  workspaceName: string;
  role: string | null;
  createdAt: string;
}>;

export type WorkspaceDetail = Readonly<{
  workspace: WorkspaceRow;
  members: readonly PlatformUserRow[];
  flags: readonly FeatureFlagState[];
  usage: Readonly<{
    customers: number;
    conversations: number;
    automations: number;
    unrecoveredDeadLetters: number;
  }>;
  /**
   * A trial that is still running on a workspace no longer in it.
   *
   * The state a suspension leaves behind, and the only one a resume applies to.
   * Resolved here, against the server's clock, because it is the answer to a
   * question about the data rather than about the rendering: a component that
   * compared a deadline to `Date.now()` while rendering would be reading a
   * different clock on the server and on hydration.
   */
  trialInterrupted: boolean;
  recentAudit: readonly PlatformAuditRow[];
}>;

export type FeatureFlagState = Readonly<{
  key: string;
  displayName: string;
  description: string;
  enabled: boolean;
  /** Which layer decided it: an override, the plan, or the catalogue default. */
  source: "override" | "plan" | "default";
  overrideReason: string | null;
  overrideExpiresAt: string | null;
}>;

export type PlatformSwitch = Readonly<{
  key: string;
  enabled: boolean;
  description: string;
  updatedAt: string;
}>;

export type PlatformAuditRow = Readonly<{
  id: number;
  actorId: string | null;
  actorRole: PlatformAdminRole;
  action: string;
  targetWorkspaceId: string | null;
  targetUserId: string | null;
  safeDetails: Readonly<Record<string, unknown>>;
  occurredAt: string;
}>;

export type ImpersonationGrant = Readonly<{
  id: string;
  adminId: string;
  workspaceId: string;
  workspaceName: string;
  reason: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}>;

export type DeadLetterRow = Readonly<{
  id: string;
  workspaceId: string;
  workspaceName: string;
  runId: string;
  errorCode: string;
  safeSummary: string;
  recoverable: boolean;
  createdAt: string;
}>;

/** An outbox row past the relay's attempt ceiling: stopped, and waiting on a person. */
export type StuckOutboxRow = Readonly<{
  id: string;
  workspaceId: string;
  workspaceName: string;
  attempts: number;
  createdAt: string;
}>;

export type OutboxHealth = Readonly<{
  pendingOutbox: number;
  exhaustedOutbox: number;
  unprocessedWebhooks: number;
}>;

/**
 * The longest a "view as" grant may run. Support sessions are minutes of work;
 * an hour is already generous, and an unbounded one is a standing cross-tenant
 * read that nobody remembers to close.
 */
export const IMPERSONATION_MAX_MINUTES = 60;
