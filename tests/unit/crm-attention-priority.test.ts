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

describe("the repository assembles the state it ranks", () => {
  function harness(over: Record<string, FakeRow[]> = {}) {
    const fake = createFakeSupabase({
      tables: {
        customers: [
          {
            id: CUSTOMER,
            workspace_id: WORKSPACE,
            lead_status: "awaiting_customer",
            lifecycle_stage: "engaged"
          }
        ],
        conversations: [],
        tasks_followups: [],
        customer_consents: [],
        crm_score_snapshots: [],
        ...over
      }
    });
    return new SupabaseCrmRepository(fake.client, workspace);
  }

  it("counts unread messages across a customer's open conversations", async () => {
    const repository = harness({
      conversations: [
        {
          id: "c1",
          workspace_id: WORKSPACE,
          customer_id: CUSTOMER,
          state: "open",
          unread_count: 2,
          requires_human_review: false
        }
      ]
    });
    expect((await repository.attentionFor(CUSTOMER, NOW)).priority).toBe("normal");
  });

  it("ignores unread messages on a closed conversation", async () => {
    // A record of what happened, not something anybody still has to answer.
    const repository = harness({
      conversations: [
        {
          id: "c2",
          workspace_id: WORKSPACE,
          customer_id: CUSTOMER,
          state: "closed",
          unread_count: 9,
          requires_human_review: false
        }
      ]
    });
    const verdict = await repository.attentionFor(CUSTOMER, NOW);
    expect(verdict.reasons.map((reason) => reason.code)).not.toContain("unanswered_inbound");
  });

  it("picks up a request for a person", async () => {
    const repository = harness({
      conversations: [
        {
          id: "c3",
          workspace_id: WORKSPACE,
          customer_id: CUSTOMER,
          state: "open",
          unread_count: 0,
          requires_human_review: true
        }
      ]
    });
    expect((await repository.attentionFor(CUSTOMER, NOW)).priority).toBe("critical");
  });

  it("treats an opt-out on any channel as an opt-out", async () => {
    // One closed channel is enough to make a queued outbound the wrong
    // suggestion.
    const repository = harness({
      conversations: [
        {
          id: "c4",
          workspace_id: WORKSPACE,
          customer_id: CUSTOMER,
          state: "open",
          unread_count: 5,
          requires_human_review: false
        }
      ],
      customer_consents: [
        {
          id: "k1",
          workspace_id: WORKSPACE,
          customer_id: CUSTOMER,
          channel: "email",
          opt_out: false
        },
        {
          id: "k2",
          workspace_id: WORKSPACE,
          customer_id: CUSTOMER,
          channel: "whatsapp",
          opt_out: true
        }
      ]
    });
    expect((await repository.attentionFor(CUSTOMER, NOW)).priority).toBe("low");
  });

  it("ranks on the soonest live follow-up", async () => {
    // Four pending follow-ups do not make a contact four times as urgent.
    const repository = harness({
      tasks_followups: [
        {
          id: "f1",
          workspace_id: WORKSPACE,
          customer_id: CUSTOMER,
          eligibility_state: "eligible",
          due_at: EARLIER,
          next_eligible_at: null
        },
        {
          id: "f2",
          workspace_id: WORKSPACE,
          customer_id: CUSTOMER,
          eligibility_state: "eligible",
          due_at: NEXT_WEEK,
          next_eligible_at: null
        }
      ]
    });
    const verdict = await repository.attentionFor(CUSTOMER, NOW);
    expect(verdict.reasons.map((reason) => reason.code)).toContain("followup_overdue");
  });

  it("does not read another customer's state", async () => {
    const repository = harness({
      conversations: [
        {
          id: "c5",
          workspace_id: WORKSPACE,
          customer_id: "someone-else",
          state: "open",
          unread_count: 9,
          requires_human_review: true
        }
      ]
    });
    expect((await repository.attentionFor(CUSTOMER, NOW)).priority).toBe("low");
  });

  it("does not read another workspace's state", async () => {
    const repository = harness({
      conversations: [
        {
          id: "c6",
          workspace_id: "someone-else",
          customer_id: CUSTOMER,
          state: "open",
          unread_count: 9,
          requires_human_review: true
        }
      ]
    });
    expect((await repository.attentionFor(CUSTOMER, NOW)).priority).toBe("low");
  });
});
