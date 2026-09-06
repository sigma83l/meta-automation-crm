import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWorkspaceOverview } from "@/src/modules/workspaces/server/overview-read-model";

type Answer = Readonly<{ data: unknown; error: unknown }>;

/**
 * Records what was asked for and answers with a fixed result.
 *
 * Deliberately not the PostgREST double in tests/fixtures: what matters here
 * is which relation is queried, how it is filtered, and what happens to the
 * answer - none of which needs filter semantics reimplemented to observe.
 */
function stubClient(answer: Answer) {
  const asked: { from?: string; select?: string; eq: [string, unknown][] } = { eq: [] };
  const builder = {
    select(columns: string) {
      asked.select = columns;
      return builder;
    },
    eq(column: string, value: unknown) {
      asked.eq.push([column, value]);
      return builder;
    },
    maybeSingle: async () => answer
  };
  const client = {
    from(relation: string) {
      asked.from = relation;
      return builder;
    }
  };
  return { client: client as unknown as SupabaseClient, asked };
}

const row = {
  conversations_awaiting_human: 3,
  handoffs_open: 2,
  followups_due: 7,
  connections_needing_attention: 1
};

describe("the workspace overview is read from the view", () => {
  it("reads the view rather than the tables underneath it", async () => {
    // The point of P10 was one definition of "awaiting human". Counting the
    // base tables here would restore the second definition it removed.
    const { client, asked } = stubClient({ data: row, error: null });
    await loadWorkspaceOverview(client, "ws_1");
    expect(asked.from).toBe("workspace_overview_view");
  });

  it("narrows to the resolved workspace", async () => {
    // RLS already limits the view to the caller's workspaces. This is the
    // other half: of those, the one actually being displayed.
    const { client, asked } = stubClient({ data: row, error: null });
    await loadWorkspaceOverview(client, "ws_1");
    expect(asked.eq).toEqual([["workspace_id", "ws_1"]]);
  });

  it("asks only for the columns it maps", async () => {
    const { client, asked } = stubClient({ data: row, error: null });
    await loadWorkspaceOverview(client, "ws_1");
    expect(asked.select).toBe(
      "conversations_awaiting_human,handoffs_open,followups_due,connections_needing_attention"
    );
  });

  it("maps every column to the shape the dashboard reads", async () => {
    const { client } = stubClient({ data: row, error: null });
    expect(await loadWorkspaceOverview(client, "ws_1")).toEqual({
      conversationsAwaitingHuman: 3,
      handoffsOpen: 2,
      followupsDue: 7,
      connectionsNeedingAttention: 1
    });
  });
});

describe("a failed read is not an empty queue", () => {
  it("returns null when the query errors", async () => {
    // The whole reason this returns null. Zeroes here would render "nothing
    // needs you" on the strength of a query that never answered, and that is
    // the one wrong answer this panel must never give.
    const { client } = stubClient({ data: null, error: { message: "denied" } });
    expect(await loadWorkspaceOverview(client, "ws_1")).toBeNull();
  });

  it("returns null when no row comes back", async () => {
    const { client } = stubClient({ data: null, error: null });
    expect(await loadWorkspaceOverview(client, "ws_1")).toBeNull();
  });

  it("does not confuse an error with a row of zeroes", async () => {
    const failed = stubClient({ data: null, error: { message: "denied" } });
    const empty = stubClient({
      data: {
        conversations_awaiting_human: 0,
        handoffs_open: 0,
        followups_due: 0,
        connections_needing_attention: 0
      },
      error: null
    });
    expect(await loadWorkspaceOverview(failed.client, "ws_1")).toBeNull();
    expect(await loadWorkspaceOverview(empty.client, "ws_1")).toEqual({
      conversationsAwaitingHuman: 0,
      handoffsOpen: 0,
      followupsDue: 0,
      connectionsNeedingAttention: 0
    });
  });

  it("treats a null count as zero, since an aggregate can be null", async () => {
    // A left join with nothing on the right side yields null, not 0.
    const { client } = stubClient({
      data: { ...row, followups_due: null, handoffs_open: null },
      error: null
    });
    expect(await loadWorkspaceOverview(client, "ws_1")).toMatchObject({
      followupsDue: 0,
      handoffsOpen: 0,
      conversationsAwaitingHuman: 3
    });
  });
});
