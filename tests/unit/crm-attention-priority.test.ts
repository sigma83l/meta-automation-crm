import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeRow } from "@/tests/fixtures/fake-supabase";
import { SupabaseCrmRepository } from "@/src/modules/crm/adapters/supabase-crm-repository";
import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import {
  ATTENTION_PRIORITIES,
  hasAttentionSignals,
  rankAttention,
  type AttentionState
} from "@/src/modules/crm/attention-priority";

/**
 * What deserves attention now, which is not how good a lead is.
 *
 * The two get conflated constantly and the pack makes keeping them apart a hard
 * requirement, so the case that matters most here is the dull one: a fully
 * qualified contact with nothing outstanding is Normal. Nothing to do about
 * them today is the correct answer, and a queue that puts them at the top
 * because their score is high is a queue that wastes an operator's morning.
 */

const NOW = new Date("2026-08-28T12:00:00.000Z");
const EARLIER = "2026-08-28T09:00:00.000Z";
const LATER = "2026-08-28T18:00:00.000Z";
const NEXT_WEEK = "2026-09-04T12:00:00.000Z";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";

const workspace: TrustedWorkspace = {
  id: WORKSPACE,
  name: "Probe",
  userId: "55555555-5555-4555-8555-555555555555",
  role: "operator"
};

const state = (over: Partial<AttentionState> = {}): AttentionState => ({
  leadStatus: "awaiting_customer",
  lifecycleStage: "engaged",
  unreadInbound: 0,
  humanReviewRequested: false,
  optedOut: false,
  ...over
});

const rank = (over: Partial<AttentionState> = {}) => rankAttention(state(over), NOW).priority;

const codes = (over: Partial<AttentionState> = {}) =>
  rankAttention(state(over), NOW).reasons.map((reason) => reason.code);

describe("a score is not a priority", () => {
  it("leaves a well qualified contact with nothing outstanding at normal", () => {
    // The case the whole separation exists for.
    expect(rank({ qualificationScore: 95, leadStatus: "booked" })).toBe("normal");
  });

  it("does not raise a contact just for scoring well", () => {
    expect(rank({ qualificationScore: 100 })).toBe("normal");
  });

  it("ranks an unscored contact who is waiting on us above a scored one who is not", () => {
    expect(rank({ leadStatus: "needs_reply", qualificationScore: null })).toBe("high");
    expect(rank({ leadStatus: "booked", qualificationScore: 95 })).toBe("normal");
  });

  it("keeps a booked contact visible without making them urgent", () => {
    const quiet = rankAttention(state({ leadStatus: "booked", qualificationScore: 10 }), NOW);
    expect(quiet.priority).toBe("normal");
  });
});

describe("what raises a priority", () => {
  it("puts an explicit request for a person at the top", () => {
    expect(rank({ humanReviewRequested: true })).toBe("critical");
    expect(rank({ leadStatus: "human_review" })).toBe("critical");
  });

  it("puts a pending payment at the top", () => {
    // The one status where delay costs the customer something rather than
    // merely annoying them.
    expect(rank({ leadStatus: "payment_pending" })).toBe("critical");
  });

  it("raises an unanswered inbound message", () => {
    expect(rank({ unreadInbound: 1, leadStatus: "booked" })).toBe("high");
    expect(rank({ leadStatus: "needs_reply" })).toBe("high");
  });

  it("raises an overdue follow-up", () => {
    expect(rank({ followUpDueAt: EARLIER, leadStatus: "booked" })).toBe("high");
  });

  it("keeps a follow-up due later today at normal", () => {
    expect(rank({ followUpDueAt: LATER, leadStatus: "booked" })).toBe("normal");
  });

  it("says nothing about a follow-up due next week", () => {
    expect(codes({ followUpDueAt: NEXT_WEEK, leadStatus: "booked" })).not.toContain(
      "followup_due_soon"
    );
  });

  it("takes the strongest reason rather than adding several mild ones up", () => {
    // Two normals do not make a high. Adding weights and thresholding them
    // would rebuild the 0-100 number the pack rules out and hide it behind four
    // labels.
    const mild = rankAttention(
      state({ leadStatus: "booked", qualificationScore: 90, followUpDueAt: LATER }),
      NOW
    );
    expect(mild.priority).toBe("normal");
  });
});

describe("what caps a priority", () => {
  it("holds a contact whose next move is theirs no higher than normal", () => {
    // With nothing outstanding at all there is not even a reason to look.
    expect(rank({ leadStatus: "awaiting_customer", unreadInbound: 0 })).toBe("low");
    // Even with an overdue follow-up: chasing is on the list, but nothing is
    // urgent while we are not the ones blocking.
    expect(rank({ leadStatus: "awaiting_customer", followUpDueAt: EARLIER })).toBe("normal");
  });

  it("drops a snoozed contact to low", () => {
    expect(rank({ followUpDueAt: EARLIER, followUpSnoozedUntil: LATER })).toBe("low");
  });

  it("ignores a snooze whose time has passed", () => {
    // A deferral that has expired is a follow-up that has come back.
    expect(
      rank({ followUpDueAt: EARLIER, followUpSnoozedUntil: EARLIER, leadStatus: "booked" })
    ).toBe("high");
  });

  it("drops an opted-out contact to low", () => {
    expect(rank({ optedOut: true, unreadInbound: 3, leadStatus: "needs_reply" })).toBe("low");
  });

  it("drops a closed conversation to low", () => {
    expect(rank({ leadStatus: "closed", qualificationScore: 90 })).toBe("low");
  });

  it("takes the strictest cap in force", () => {
    expect(rank({ leadStatus: "awaiting_customer", optedOut: true, followUpDueAt: EARLIER })).toBe(
      "low"
    );
  });
});

describe("a request for a person is never capped", () => {
  it("survives a snooze", () => {
    // The failure this carve-out exists to prevent: somebody asks for a human
    // and the queue hides them because a follow-up was deferred.
    expect(rank({ humanReviewRequested: true, followUpSnoozedUntil: LATER })).toBe("critical");
  });

  it("survives an opt-out", () => {
    // Every penalty here is a reason not to send something. This is a request
    // to look, which is a different act.
    expect(rank({ humanReviewRequested: true, optedOut: true })).toBe("critical");
  });

  it("survives a closed conversation", () => {
    expect(rank({ leadStatus: "closed", humanReviewRequested: true })).toBe("critical");
  });

  it("does not extend the carve-out to anything else", () => {
    // A pending payment is urgent and still capped by an opt-out, because
    // chasing money from somebody who opted out is the wrong suggestion.
    expect(rank({ leadStatus: "payment_pending", optedOut: true })).toBe("low");
  });
});

describe("the verdict explains itself", () => {
  it("names every reason that argued for the priority", () => {
    expect(codes({ leadStatus: "needs_reply", unreadInbound: 2, qualificationScore: 80 })).toEqual([
      "unanswered_inbound",
      "well_qualified"
    ]);
  });

  it("names the penalties too, so a demotion is not silent", () => {
    const verdict = rankAttention(state({ unreadInbound: 1, optedOut: true }), NOW);
    expect(verdict.priority).toBe("low");
    expect(verdict.reasons).toContainEqual({
      code: "opted_out",
      effect: "caps",
      level: "low"
    });
    // The raising reason is kept as well: an operator can see there was
    // something to answer and why it is not being surfaced.
    expect(verdict.reasons).toContainEqual({
      code: "unanswered_inbound",
      effect: "raises",
      level: "high"
    });
  });

  it("produces no fake number anywhere in the verdict", () => {
    const verdict = rankAttention(state({ unreadInbound: 4, qualificationScore: 90 }), NOW);
    expect(ATTENTION_PRIORITIES).toContain(verdict.priority);
    expect(Object.keys(verdict)).toEqual(["priority", "reasons"]);
  });

  it("ranks the same state the same way twice", () => {
    const input = state({ unreadInbound: 1, followUpDueAt: EARLIER, qualificationScore: 75 });
    expect(rankAttention(input, NOW)).toEqual(rankAttention(input, NOW));
  });
});

describe("spotting a queue worth opening", () => {
  it("is true when anything needs action", () => {
    expect(hasAttentionSignals([rankAttention(state({ leadStatus: "needs_reply" }), NOW)])).toBe(
      true
    );
  });

  it("is false when everything is merely fine", () => {
    expect(
      hasAttentionSignals([
        rankAttention(state({ leadStatus: "booked", qualificationScore: 90 }), NOW),
        rankAttention(state({ leadStatus: "closed" }), NOW)
      ])
    ).toBe(false);
  });
});

describe("the repository ranks the state the view assembles", () => {
  /**
   * The five queries this used to run are one row of `crm_radar_view` now, so
   * what the assembly does with conversations, consents and follow-ups is
   * checked against a real engine in `tests/migrations/next-action-and-radar`.
   * What is left here is the part that lives in TypeScript: reading the right
   * row, and ranking it.
   */
  function harness(rows: FakeRow[]) {
    const fake = createFakeSupabase({ tables: { crm_radar_view: rows } });
    return new SupabaseCrmRepository(fake.client, workspace);
  }

  const row = (over: Partial<FakeRow> = {}): FakeRow => ({
    workspace_id: WORKSPACE,
    customer_id: CUSTOMER,
    display_name: "Probe",
    company_name: null,
    status: "active",
    source: "manual",
    lifecycle_stage: "engaged",
    lead_status: "awaiting_customer",
    created_at: EARLIER,
    updated_at: EARLIER,
    score: null,
    unread_inbound: 0,
    human_review_requested: false,
    followup_due_at: null,
    followup_snoozed_until: null,
    opted_out: false,
    has_evidence: false,
    owner_id: null,
    channel: null,
    last_activity_at: EARLIER,
    current_need: null,
    current_need_confidence: null,
    ...over
  });

  it("ranks the row it read", async () => {
    const repository = harness([row({ unread_inbound: 2 })]);
    expect((await repository.attentionFor(CUSTOMER, NOW)).priority).toBe("normal");
  });

  it("picks up a request for a person", async () => {
    const repository = harness([
      row({ human_review_requested: true, lead_status: "human_review" })
    ]);
    expect((await repository.attentionFor(CUSTOMER, NOW)).priority).toBe("critical");
  });

  it("caps a contact who opted out, whatever else is true", async () => {
    const repository = harness([row({ unread_inbound: 5, opted_out: true })]);
    expect((await repository.attentionFor(CUSTOMER, NOW)).priority).toBe("low");
  });

  it("does not read another customer's row", async () => {
    const repository = harness([
      row({ customer_id: "someone-else", unread_inbound: 9, human_review_requested: true })
    ]);
    await expect(repository.attentionFor(CUSTOMER, NOW)).rejects.toThrow("CUSTOMER_NOT_FOUND");
  });

  it("does not read another workspace's row", async () => {
    const repository = harness([
      row({ workspace_id: "someone-else", unread_inbound: 9, human_review_requested: true })
    ]);
    await expect(repository.attentionFor(CUSTOMER, NOW)).rejects.toThrow("CUSTOMER_NOT_FOUND");
  });
});
