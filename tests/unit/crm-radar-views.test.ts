import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeRow } from "@/tests/fixtures/fake-supabase";
import { SupabaseCrmRepository } from "@/src/modules/crm/adapters/supabase-crm-repository";
import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import {
  BUILT_IN_RADAR_VIEWS,
  RADAR_VIEW_KEYS,
  isRadarViewKey,
  landingRadarView,
  matchesAttention
} from "@/src/modules/crm/radar-views";
import { rankAttention } from "@/src/modules/crm/attention-priority";

/**
 * The lists an operator picks between.
 *
 * Two of the seven ask a question no column answers, so they filter the ranked
 * row and the read continues when a page comes back short. That is where this
 * can go quietly wrong: a filtered page that stops early silently hides rows,
 * and a cursor taken from the wrong row skips the ones in between. Both are
 * invisible in a screenshot and obvious in a test.
 */

const NOW = new Date("2026-08-28T12:00:00.000Z");
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OWNER = "55555555-5555-4555-8555-555555555555";
const id = (n: number) => `2222${String(n).padStart(4, "0")}-2222-4222-8222-222222222222`;

const workspace: TrustedWorkspace = {
  id: WORKSPACE,
  name: "Probe",
  userId: OWNER,
  role: "operator"
};
const viewer: TrustedWorkspace = { ...workspace, role: "viewer" };

const viewRow = (over: Partial<FakeRow> = {}): FakeRow => ({
  workspace_id: WORKSPACE,
  customer_id: id(0),
  display_name: "Probe",
  company_name: null,
  status: "active",
  source: "manual",
  lifecycle_stage: "engaged",
  lead_status: "awaiting_customer",
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
  score: null,
  unread_inbound: 0,
  human_review_requested: false,
  followup_due_at: null,
  followup_snoozed_until: null,
  opted_out: false,
  has_evidence: false,
  owner_id: null,
  channel: null,
  last_activity_at: "2026-08-20T00:00:00.000Z",
  current_need: null,
  current_need_confidence: null,
  ...over
});

/** A row nothing argues about: Normal, no raising reason, not in Needs Attention. */
const quiet = (n: number, over: Partial<FakeRow> = {}) =>
  viewRow({
    customer_id: id(n),
    updated_at: `2026-08-${String(28 - n).padStart(2, "0")}T00:00:00.000Z`,
    lifecycle_stage: "engaged",
    lead_status: "awaiting_customer",
    ...over
  });

/** A row that argues for action: somebody asked for a person. */
const loud = (n: number, over: Partial<FakeRow> = {}) =>
  quiet(n, { lead_status: "human_review", human_review_requested: true, ...over });

function harness(rows: FakeRow[], as: TrustedWorkspace = workspace) {
  const fake = createFakeSupabase({ tables: { crm_radar_view: rows, crm_saved_views: [] } });
  return { fake, repository: new SupabaseCrmRepository(fake.client, as) };
}

describe("what a view means", () => {
  it("defines every view the pack names", () => {
    expect(RADAR_VIEW_KEYS).toEqual([
      "needs_attention",
      "all_customers",
      "follow_up_due",
      "qualified",
      "sales_ready",
      "customers",
      "recently_active"
    ]);
    for (const key of RADAR_VIEW_KEYS) expect(BUILT_IN_RADAR_VIEWS[key]).toBeDefined();
  });

  it("holds values and never a fragment of a query", () => {
    for (const filters of Object.values(BUILT_IN_RADAR_VIEWS)) {
      for (const value of Object.values(filters)) {
        expect(typeof value === "string" || typeof value === "number").toBe(true);
        if (typeof value === "string") expect(value).toMatch(/^[a-z_]+$/);
      }
    }
  });

  it("refuses a view key it does not define", () => {
    expect(isRadarViewKey("needs_attention")).toBe(true);
    expect(isRadarViewKey("customers; drop table")).toBe(false);
    expect(isRadarViewKey(undefined)).toBe(false);
  });

  it("counts a contact somebody asked a person for as needing attention", () => {
    const verdict = rankAttention(
      {
        leadStatus: "human_review",
        lifecycleStage: "engaged",
        unreadInbound: 0,
        humanReviewRequested: true,
        optedOut: false
      },
      NOW
    );
    expect(matchesAttention("needs_attention", verdict)).toBe(true);
  });

  it("leaves out a contact whose every signal was capped away", () => {
    // Opted out is the case the queue must not surface: something would
    // otherwise argue loudly for a reply that must never be sent.
    const verdict = rankAttention(
      {
        leadStatus: "needs_reply",
        lifecycleStage: "engaged",
        unreadInbound: 3,
        humanReviewRequested: false,
        optedOut: true
      },
      NOW
    );
    expect(verdict.priority).toBe("low");
    expect(matchesAttention("needs_attention", verdict)).toBe(false);
  });

  it("puts an overdue follow-up in Follow-up Due and a quiet contact in neither", () => {
    const overdue = rankAttention(
      {
        leadStatus: "follow_up_due",
        lifecycleStage: "engaged",
        unreadInbound: 0,
        humanReviewRequested: false,
        followUpDueAt: "2026-08-27T00:00:00.000Z",
        optedOut: false
      },
      NOW
    );
    expect(matchesAttention("follow_up_due", overdue)).toBe(true);

    const nothing = rankAttention(
      {
        leadStatus: "awaiting_customer",
        lifecycleStage: "engaged",
        unreadInbound: 0,
        humanReviewRequested: false,
        optedOut: false
      },
      NOW
    );
    expect(matchesAttention("follow_up_due", nothing)).toBe(false);
    expect(matchesAttention("needs_attention", nothing)).toBe(false);
  });

  it("lands on the full list only when the queue is empty", () => {
    expect(landingRadarView(true)).toBe("needs_attention");
    expect(landingRadarView(false)).toBe("all_customers");
  });
});

describe("reading a filtered page", () => {
  it("keeps reading past a page of rows the view excludes", async () => {
    // Three pages' worth of quiet rows in front of the one that matters. A
    // single read would have returned an empty Needs Attention list beside a
    // record screen calling that contact Critical.
    const rows = [...Array.from({ length: 12 }, (_, index) => quiet(index)), loud(20)];
    const { repository } = harness(rows);
    const page = await repository.radar({ ...BUILT_IN_RADAR_VIEWS.needs_attention, limit: 5 }, NOW);
    expect(page.rows.map((row) => row.customerId)).toEqual([id(20)]);
    expect(page.nextCursor).toBeNull();
  });

  it("stops with a cursor rather than walking the whole workspace", async () => {
    const rows = Array.from({ length: 60 }, (_, index) => quiet(index));
    const { repository } = harness(rows);
    const page = await repository.radar({ ...BUILT_IN_RADAR_VIEWS.needs_attention, limit: 5 }, NOW);
    expect(page.rows).toHaveLength(0);
    // A short page and a way to continue, rather than an unbounded request.
    expect(page.nextCursor).not.toBeNull();
  });

  it("resumes from the cursor without repeating or skipping a row", async () => {
    const rows = Array.from({ length: 6 }, (_, index) => loud(index));
    const { repository } = harness(rows);
    const first = await repository.radar(
      { ...BUILT_IN_RADAR_VIEWS.needs_attention, limit: 2 },
      NOW
    );
    expect(first.rows.map((row) => row.customerId)).toEqual([id(0), id(1)]);
    expect(first.nextCursor).not.toBeNull();

    const second = await repository.radar(
      { ...BUILT_IN_RADAR_VIEWS.needs_attention, limit: 2, cursor: first.nextCursor },
      NOW
    );
    expect(second.rows.map((row) => row.customerId)).toEqual([id(2), id(3)]);
  });

  it("takes the cursor from the last row it kept, not the last it read", async () => {
    // The page fills in the middle of a batch. A cursor pointing at the end of
    // that batch would drop everything between, which no error reports.
    const rows = [loud(0), loud(1), quiet(2), loud(3)];
    const { repository } = harness(rows);
    const first = await repository.radar(
      { ...BUILT_IN_RADAR_VIEWS.needs_attention, limit: 2 },
      NOW
    );
    expect(first.nextCursor?.customerId).toBe(id(1));
    const second = await repository.radar(
      { ...BUILT_IN_RADAR_VIEWS.needs_attention, limit: 2, cursor: first.nextCursor },
      NOW
    );
    expect(second.rows.map((row) => row.customerId)).toEqual([id(3)]);
  });

  it("filters Recently Active by last activity rather than by the cursor column", async () => {
    const { repository } = harness([
      // Edited recently, silent for a month: the pagination key says today and
      // the question being asked is about the relationship.
      quiet(1, {
        updated_at: "2026-08-27T00:00:00.000Z",
        last_activity_at: "2026-07-01T00:00:00.000Z"
      }),
      quiet(2, {
        updated_at: "2026-08-26T00:00:00.000Z",
        last_activity_at: "2026-08-27T00:00:00.000Z"
      })
    ]);
    const page = await repository.radar(BUILT_IN_RADAR_VIEWS.recently_active, NOW);
    expect(page.rows.map((row) => row.customerId)).toEqual([id(2)]);
  });

  it("searches the name and the company", async () => {
    const { repository } = harness([
      quiet(1, { display_name: "Ada Lovelace" }),
      quiet(2, { display_name: "Someone", company_name: "Lovelace Ltd" }),
      quiet(3, { display_name: "Nobody" })
    ]);
    const page = await repository.radar({ query: "lovelace" }, NOW);
    expect(page.rows.map((row) => row.customerId)).toEqual([id(1), id(2)]);
  });

  it("shows what the contact currently wants, and how firm that is", async () => {
    const { repository } = harness([
      quiet(1, { current_need: "A quote for 200 units", current_need_confidence: "confirmed" }),
      quiet(2)
    ]);
    const page = await repository.radar({}, NOW);
    expect(page.rows[0]).toMatchObject({
      currentNeed: "A quote for 200 units",
      currentNeedConfidence: "confirmed"
    });
    // Not invented, and not hidden either: the column says unknown.
    expect(page.rows[1]).toMatchObject({ currentNeed: null, currentNeedConfidence: null });
  });

  it("refuses a cursor that is not the two values it issued", async () => {
    const { repository } = harness([quiet(1)]);
    await expect(
      repository.radar(
        { cursor: { updatedAt: "2026-08-20T00:00:00.000Z", customerId: "a,b)" } },
        NOW
      )
    ).rejects.toThrow("INVALID_RADAR_CURSOR");
    await expect(
      repository.radar({ cursor: { updatedAt: "now()", customerId: id(1) } }, NOW)
    ).rejects.toThrow("INVALID_RADAR_CURSOR");
  });
});

describe("a view the workspace defined", () => {
  it("stores the filters as values and reads them back", async () => {
    const { fake, repository } = harness([]);
    const saved = await repository.saveView({
      name: "Stalled deals",
      filters: { lifecycleStage: "opportunity", activeWithinDays: 30 }
    });
    expect(saved.filters).toEqual({ lifecycleStage: "opportunity", activeWithinDays: 30 });

    const [row] = fake.database.rows("crm_saved_views");
    expect(row).toMatchObject({
      workspace_id: WORKSPACE,
      name: "Stalled deals",
      lifecycle_stage: "opportunity",
      active_within_days: 30,
      lead_status: null,
      attention: null,
      created_by: OWNER
    });

    expect(await repository.savedViews()).toEqual([saved]);
  });

  it("refuses a filter value outside the vocabulary", async () => {
    const { repository } = harness([]);
    await expect(
      repository.saveView({
        name: "Anything",
        filters: { lifecycleStage: "'; drop table customers" } as never
      })
    ).rejects.toThrow();
  });

  it("refuses a definition with nothing in it", async () => {
    const { repository } = harness([]);
    await expect(repository.saveView({ name: "Everything", filters: {} })).rejects.toThrow();
  });

  it("does not let a viewer redefine what the team's index means", async () => {
    const { repository } = harness([], viewer);
    await expect(
      repository.saveView({ name: "Mine", filters: { attention: "needs_attention" } })
    ).rejects.toThrow(/operator/i);
    await expect(repository.deleteSavedView(id(9))).rejects.toThrow(/operator/i);
  });

  it("applies a saved view's filters like a built-in one", async () => {
    const { repository } = harness([
      quiet(1, { lifecycle_stage: "opportunity" }),
      quiet(2, { lifecycle_stage: "new" })
    ]);
    const saved = await repository.saveView({
      name: "Deals",
      filters: { lifecycleStage: "opportunity" }
    });
    const page = await repository.radar(saved.filters, NOW);
    expect(page.rows.map((row) => row.customerId)).toEqual([id(1)]);
  });
});
