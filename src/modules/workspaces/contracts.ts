/**
 * Workspace shapes shared between the server and the UI.
 *
 * Separate from the modules that produce them so a client component can name
 * the shape without importing a `server-only` module to get at it.
 */

/**
 * The workspace overview, as `workspace_overview_view` defines it.
 *
 * Four counts, and all four are questions about work waiting on a person
 * rather than totals describing the workspace. That distinction is the point
 * of the view: totals are reassuring and inert, whereas these change what
 * somebody does next.
 */
export type WorkspaceOverview = Readonly<{
  conversationsAwaitingHuman: number;
  handoffsOpen: number;
  followupsDue: number;
  connectionsNeedingAttention: number;
}>;
