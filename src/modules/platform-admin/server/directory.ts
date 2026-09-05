import "server-only";

import { subscriptionStatuses } from "@/src/modules/billing/contracts";

import type {
  PlatformOverview,
  PlatformUserRow,
  WorkspaceDetail,
  WorkspaceRow
} from "../contracts";
import { listPlatformAudit } from "./audit";
import { loadWorkspaceFlagStates } from "./feature-flags";
import { listActiveImpersonations } from "./impersonation";
import type { PlatformAdminRuntime } from "./runtime";

/**
 * Email as the console shows it: `h•••@gmail.com`.
 *
 * Staff need to recognise an account and to match the address a customer quoted
 * in a ticket, and both survive masking. What masking removes is the bulk
 * harvest — a directory screen that renders four hundred plaintext addresses is
 * a copy-paste away from being an export, which `AGENTS.md` forbids outright.
 * Lookup still works on the full address: `searchUsers` matches server-side
 * against the unmasked value and returns the masked one.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "—";
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  return `${local.slice(0, 1)}•••${domain}`;
}

async function countOf(
  runtime: PlatformAdminRuntime,
  table: string,
  filters: Readonly<Record<string, string>> = {}
) {
  let query = runtime.db.from(table).select("*", { count: "exact", head: true });
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { count } = await query;
  return count ?? 0;
}

/**
 * Counts a table by a column's values, asking the database for each count.
 *
 * The alternative — selecting every row and tallying in JavaScript — is what
 * this replaced, and it was wrong in a way that never surfaced: PostgREST caps
 * an unbounded select at its `max-rows` setting, so past that many rows the
 * panel would have reported a total quietly smaller than the truth, with no
 * error and nothing on screen to suggest it. A head request per value is a few
 * more round trips and cannot be short.
 */
async function countByValue(
  runtime: PlatformAdminRuntime,
  table: string,
  column: string,
  values: readonly string[]
): Promise<Record<string, number>> {
  const counts = await Promise.all(
    values.map(
      async (value) => [value, await countOf(runtime, table, { [column]: value })] as const
    )
  );
  return Object.fromEntries(counts.filter(([, total]) => total > 0));
}

export async function loadPlatformOverview(
  runtime: PlatformAdminRuntime
): Promise<PlatformOverview> {
  const [
    workspacesTotal,
    workspacesActive,
    usersTotal,
    usersActive,
    subscriptions,
    deadLetters,
    connections,
    supportTickets,
    impersonations
  ] = await Promise.all([
    countOf(runtime, "workspaces"),
    countOf(runtime, "workspaces", { status: "active" }),
    countOf(runtime, "profiles"),
    countOf(runtime, "profiles", { status: "active" }),
    countByValue(runtime, "workspace_subscriptions", "status", subscriptionStatuses),
    runtime.db
      .from("automation_dead_letters")
      .select("*", { count: "exact", head: true })
      .is("recovered_at", null),
    // "Needs attention" is anything not both connected and healthy, which is
    // one head count subtracted from another rather than a scan. The two
    // columns disagree often enough to matter: a connection can sit at 'active'
    // with an expired token, which is precisely the state a customer reports as
    // "it stopped working" and no single column names.
    Promise.all([
      countOf(runtime, "meta_connections"),
      countOf(runtime, "meta_connections", { status: "active", last_health_status: "healthy" })
    ]),
    // Both states that are waiting on us. `awaiting_customer` is not: the ball
    // is with the customer there, and counting it would put a number on this
    // panel that nobody in the room can act on — which is the one thing the
    // attention row is supposed not to do.
    runtime.db
      .from("support_tickets")
      .select("*", { count: "exact", head: true })
      .in("status", ["open", "awaiting_support"]),
    listActiveImpersonations(runtime)
  ]);

  const [connectionsTotal, connectionsHealthy] = connections;
  const needingAttention = Math.max(connectionsTotal - connectionsHealthy, 0);

  return {
    workspaces: {
      total: workspacesTotal,
      active: workspacesActive,
      disabled: workspacesTotal - workspacesActive
    },
    users: { total: usersTotal, active: usersActive, disabled: usersTotal - usersActive },
    subscriptions,
    attention: {
      unrecoveredDeadLetters: deadLetters.count ?? 0,
      connectionsNeedingAttention: needingAttention,
      openSupportTickets: supportTickets.count ?? 0,
      activeImpersonations: impersonations.length
    }
  };
}

type SubscriptionJoin = Readonly<{
  workspace_id: string;
  status: string;
  trial_ends_at: string | null;
  subscription_plans: { plan_key: string } | { plan_key: string }[] | null;
}>;

function planKeyOf(row: SubscriptionJoin | undefined) {
  const plan = row?.subscription_plans;
  if (!plan) return null;
  return Array.isArray(plan) ? (plan[0]?.plan_key ?? null) : plan.plan_key;
}

/**
 * The workspace directory.
 *
 * Three reads rather than one join across four tables: PostgREST would express
 * the member count as an embedded aggregate, which silently drops workspaces
 * with no members — exactly the rows a support console most needs to see.
 */
export async function listWorkspaces(
  runtime: PlatformAdminRuntime,
  options: Readonly<{
    query?: string;
    status?: "active" | "disabled";
    limit?: number;
    ids?: readonly string[];
  }> = {}
): Promise<readonly WorkspaceRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  let workspaceQuery = runtime.db
    .from("workspaces")
    .select("id,name,status,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (options.ids) workspaceQuery = workspaceQuery.in("id", [...options.ids]);
  if (options.status) workspaceQuery = workspaceQuery.eq("status", options.status);
  if (options.query) workspaceQuery = workspaceQuery.ilike("name", `%${options.query}%`);

  const { data: workspaces, error } = await workspaceQuery;
  if (error) throw new Error("Workspace directory read failed.");
  const ids = (workspaces ?? []).map((row) => row.id as string);
  if (ids.length === 0) return [];

  const [memberships, subscriptions] = await Promise.all([
    runtime.db
      .from("workspace_memberships")
      .select("workspace_id")
      .in("workspace_id", ids)
      .eq("status", "active"),
    runtime.db
      .from("workspace_subscriptions")
      .select("workspace_id,status,trial_ends_at,subscription_plans(plan_key)")
      .in("workspace_id", ids)
  ]);

  const memberCounts = new Map<string, number>();
  for (const row of memberships.data ?? []) {
    const id = String(row.workspace_id);
    memberCounts.set(id, (memberCounts.get(id) ?? 0) + 1);
  }
  const subscriptionByWorkspace = new Map<string, SubscriptionJoin>();
  for (const row of (subscriptions.data ?? []) as SubscriptionJoin[]) {
    subscriptionByWorkspace.set(row.workspace_id, row);
  }

  return (workspaces ?? []).map((row) => {
    const subscription = subscriptionByWorkspace.get(row.id as string);
    return {
      id: row.id as string,
      name: row.name as string,
      status: row.status as "active" | "disabled",
      createdAt: row.created_at as string,
      memberCount: memberCounts.get(row.id as string) ?? 0,
      subscriptionStatus: subscription?.status ?? null,
      planKey: planKeyOf(subscription),
      trialEndsAt: subscription?.trial_ends_at ?? null
    };
  });
}

type ProfileRow = Readonly<{
  id: string;
  display_name: string | null;
  status: string;
  workspace_id: string;
  created_at: string;
}>;

async function decorateProfiles(
  runtime: PlatformAdminRuntime,
  profiles: readonly ProfileRow[]
): Promise<readonly PlatformUserRow[]> {
  if (profiles.length === 0) return [];
  const workspaceIds = [...new Set(profiles.map((row) => row.workspace_id))];
  const userIds = profiles.map((row) => row.id);
  const [workspaces, memberships] = await Promise.all([
    runtime.db.from("workspaces").select("id,name").in("id", workspaceIds),
    runtime.db
      .from("workspace_memberships")
      .select("user_id,workspace_id,role")
      .in("user_id", userIds)
  ]);
  const nameById = new Map((workspaces.data ?? []).map((row) => [row.id as string, row.name]));
  const roleByPair = new Map(
    (memberships.data ?? []).map((row) => [`${row.user_id}:${row.workspace_id}`, row.role])
  );
  return profiles.map((row) => ({
    userId: row.id,
    displayName: row.display_name,
    status: row.status as "active" | "disabled",
    workspaceId: row.workspace_id,
    workspaceName: (nameById.get(row.workspace_id) as string | undefined) ?? "—",
    role: (roleByPair.get(`${row.id}:${row.workspace_id}`) as string | undefined) ?? null,
    createdAt: row.created_at
  }));
}

export async function listUsers(
  runtime: PlatformAdminRuntime,
  options: Readonly<{
    workspaceId?: string;
    status?: "active" | "disabled";
    limit?: number;
  }> = {}
): Promise<readonly PlatformUserRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  let query = runtime.db
    .from("profiles")
    .select("id,display_name,status,workspace_id,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (options.workspaceId) query = query.eq("workspace_id", options.workspaceId);
  if (options.status) query = query.eq("status", options.status);
  const { data, error } = await query;
  if (error) throw new Error("User directory read failed.");
  return decorateProfiles(runtime, (data ?? []) as ProfileRow[]);
}

/** The most rows GoTrue will return in one page. */
const AUTH_PAGE_SIZE = 1000;

/**
 * The most pages either scan will walk before giving up.
 *
 * A ceiling rather than an unbounded loop, because both of these run inside a
 * page render: a directory large enough to need more than this needs a cursor
 * and a different screen, not a request that takes a minute. What matters is
 * that reaching the ceiling is reported rather than absorbed — see below.
 */
const AUTH_PAGE_LIMIT = 50;

/**
 * Walks `auth.users` a page at a time, stopping as soon as `done` says so.
 *
 * Both callers used to read page one and stop — at 200 accounts for the search
 * and 1000 for the mask lookup — which produced no error and no empty state,
 * just an answer computed from part of the directory. This exists so that the
 * paging is written once and the ceiling is a named thing both can report on.
 */
async function scanAuthUsers(
  runtime: PlatformAdminRuntime,
  visit: (users: readonly { id: string; email?: string | undefined }[]) => void,
  done: () => boolean = () => false
): Promise<{ exhaustive: boolean }> {
  for (let page = 1; page <= AUTH_PAGE_LIMIT; page += 1) {
    const { data, error } = await runtime.db.auth.admin.listUsers({
      page,
      perPage: AUTH_PAGE_SIZE
    });
    if (error) throw new Error("Account lookup failed.");
    const users = data.users ?? [];
    visit(users);
    // A short page is the last page: GoTrue fills a page until it runs out.
    if (users.length < AUTH_PAGE_SIZE) return { exhaustive: true };
    if (done()) return { exhaustive: true };
  }
  return { exhaustive: false };
}

/**
 * Find an account by the address the customer gave you.
 *
 * The match happens against `auth.users`, which PostgREST cannot reach, so this
 * goes through the admin auth API. The full address is used for matching and
 * then dropped: what comes back is the profile, and the console renders the
 * masked form.
 *
 * It reads every page, not the first one. Reading only the first meant that
 * past a couple of hundred accounts an address that existed came back as "no
 * results" — the worst possible answer for the console's primary lookup, since
 * a support conversation continues on the belief that the account is not there.
 * If the directory outgrows even the page ceiling this refuses out loud rather
 * than returning a partial scan as though it were a complete one.
 */
export async function searchUsersByEmail(
  runtime: PlatformAdminRuntime,
  email: string
): Promise<readonly PlatformUserRow[]> {
  const needle = email.trim().toLowerCase();
  if (needle.length < 3) return [];

  const matched: string[] = [];
  const { exhaustive } = await scanAuthUsers(runtime, (users) => {
    for (const user of users) {
      if ((user.email ?? "").toLowerCase().includes(needle)) matched.push(user.id);
    }
  });
  if (!exhaustive && matched.length === 0) {
    throw new Error(
      "There are too many accounts to search by address. Narrow the search or use the user id."
    );
  }
  if (matched.length === 0) return [];
  const { data: profiles } = await runtime.db
    .from("profiles")
    .select("id,display_name,status,workspace_id,created_at")
    .in("id", matched);
  return decorateProfiles(runtime, (profiles ?? []) as ProfileRow[]);
}

/**
 * Workspace names for a set of ids, for screens that hold a reference rather
 * than a row.
 *
 * The audit ledger stores `target_workspace_id` and nothing else, which is
 * correct — a ledger that copied the name would keep asserting the old one
 * after a rename. But the console then rendered the literal word "Workspace" as
 * the link text on every line, so the column that says *who was acted on*
 * distinguished no row from any other. Resolving the names at read time gives
 * the reviewer the answer and keeps the ledger a ledger.
 *
 * One query for the whole page, and a missing id is simply absent from the map:
 * a workspace deleted since the line was written has no name to report, and the
 * caller shows the reference instead of inventing one.
 */
export async function workspaceNamesFor(
  runtime: PlatformAdminRuntime,
  workspaceIds: readonly string[]
): Promise<Readonly<Record<string, string>>> {
  const unique = [...new Set(workspaceIds.filter(Boolean))];
  if (unique.length === 0) return {};
  const { data, error } = await runtime.db.from("workspaces").select("id,name").in("id", unique);
  if (error) return {};
  const names: Record<string, string> = {};
  for (const row of data ?? []) names[String(row.id)] = String(row.name);
  return names;
}

/**
 * Masked addresses for a known set of accounts, for the rows already on screen.
 *
 * Pages until every wanted id is found rather than reading the first thousand
 * accounts and stopping: the rows on screen are ordered by creation date, so the
 * accounts most likely to be missed by a single page were the newest ones — the
 * people a support console is most often looking at. An id that is genuinely
 * absent stays absent from the map and the column renders an em dash, which is
 * the honest answer and the one the callers already handle.
 */
export async function maskedEmailsFor(
  runtime: PlatformAdminRuntime,
  userIds: readonly string[]
): Promise<Readonly<Record<string, string>>> {
  if (userIds.length === 0) return {};
  const wanted = new Set(userIds);
  const masked: Record<string, string> = {};
  try {
    await scanAuthUsers(
      runtime,
      (users) => {
        for (const user of users) {
          if (wanted.has(user.id)) masked[user.id] = maskEmail(user.email);
        }
      },
      // Every row on screen is accounted for; the rest of the directory is not
      // this call's business.
      () => Object.keys(masked).length === wanted.size
    );
  } catch {
    // Unchanged on purpose: a decoration that cannot be fetched must not take
    // the directory it decorates down with it.
    return masked;
  }
  return masked;
}

export async function loadWorkspaceDetail(
  runtime: PlatformAdminRuntime,
  workspaceId: string
): Promise<WorkspaceDetail> {
  const [workspaces, members, flags, customers, conversations, automations, deadLetters, audit] =
    await Promise.all([
      listWorkspaces(runtime, { ids: [workspaceId], limit: 1 }).then((rows) => rows[0]),
      listUsers(runtime, { workspaceId }),
      loadWorkspaceFlagStates(runtime, workspaceId),
      countOf(runtime, "customers", { workspace_id: workspaceId }),
      countOf(runtime, "conversations", { workspace_id: workspaceId }),
      countOf(runtime, "automations", { workspace_id: workspaceId }),
      runtime.db
        .from("automation_dead_letters")
        .select("*", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .is("recovered_at", null),
      listPlatformAudit(runtime, { workspaceId, limit: 25 })
    ]);

  if (!workspaces) throw new Error("Workspace not found.");
  const trialEndsAt = workspaces.trialEndsAt ? Date.parse(workspaces.trialEndsAt) : Number.NaN;
  return {
    workspace: workspaces,
    trialInterrupted:
      workspaces.subscriptionStatus !== "trialing" &&
      Number.isFinite(trialEndsAt) &&
      trialEndsAt > Date.now(),
    members,
    flags,
    usage: {
      customers,
      conversations,
      automations,
      unrecoveredDeadLetters: deadLetters.count ?? 0
    },
    recentAudit: audit
  };
}
