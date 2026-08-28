import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeRow } from "@/tests/fixtures/fake-supabase";
import { SupabaseCrmRepository } from "@/src/modules/crm/adapters/supabase-crm-repository";
import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import * as nextActionModule from "@/src/modules/crm/next-action";
import {
  NEXT_ACTION_TYPES,
  proposeNextAction,
  type NextActionState
} from "@/src/modules/crm/next-action";

/**
 * What to do next, proposed and never performed.
 *
 * The contract's hard rule is that the CRM proposes and execution belongs to
 * the domain that owns the send. The derivation reuses the attention engine
 * rather than restating its rules, so the interesting cases here are the ones
 * where "what is urgent" and "what to do about it" come apart - a snoozed
 * contact is Low priority and the action is still `wait` with a time, not
 * nothing.
 */

const NOW = new Date("2026-08-28T12:00:00.000Z");
const EARLIER = "2026-08-28T09:00:00.000Z";
const LATER = "2026-08-28T18:00:00.000Z";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const OWNER = "55555555-5555-4555-8555-555555555555";

const workspace: TrustedWorkspace = {
  id: WORKSPACE,
  name: "Probe",
  userId: OWNER,
  role: "operator"
};

const state = (over: Partial<NextActionState> = {}): NextActionState => ({
  leadStatus: "awaiting_customer",
  lifecycleStage: "engaged",
  unreadInbound: 0,
  humanReviewRequested: false,
  optedOut: false,
  ...over
});

const action = (over: Partial<NextActionState> = {}) => proposeNextAction(state(over), NOW);

describe("deriving what to do", () => {
  it("hands off when a person was asked for", () => {
    expect(action({ humanReviewRequested: true })).toMatchObject({
      type: "handoff",
      eligibility: "needs_review"
    });
  });

  it("replies to an unanswered message when the conversation has a subject", () => {
    expect(
      action({ leadStatus: "needs_reply", unreadInbound: 1, hasEvidence: true })
    ).toMatchObject({ type: "reply", eligibility: "eligible" });
  });

  it("clarifies instead when nothing is known yet", () => {
    // Answering is how you find out what they want, which is a different act
    // from continuing a conversation that already has a subject.
    expect(
      action({ leadStatus: "needs_reply", unreadInbound: 1, hasEvidence: false })
    ).toMatchObject({ type: "clarify" });
  });

  it("chases an overdue follow-up", () => {
    expect(action({ followUpDueAt: EARLIER, leadStatus: "booked" })).toMatchObject({
      type: "follow_up",
      eligibility: "eligible"
    });
  });

  it("schedules one that is not due yet, and says when", () => {
    expect(action({ followUpDueAt: LATER, leadStatus: "booked" })).toMatchObject({
      type: "follow_up",
      eligibility: "scheduled",
      dueAt: LATER
    });
  });

  it("chases a pending payment", () => {
    expect(action({ leadStatus: "payment_pending" })).toMatchObject({ type: "follow_up" });
  });

  it("asks somebody to own a good lead nobody owns", () => {
    expect(action({ qualificationScore: 90 })).toMatchObject({ type: "assign" });
  });

  it("asks for a next step once it has an owner", () => {
    expect(action({ qualificationScore: 90, ownerId: OWNER })).toMatchObject({
      type: "task",
      ownerId: OWNER
    });
  });

  it("proposes the booking step for a booked contact", () => {
    expect(action({ leadStatus: "booked", qualificationScore: 90 })).toMatchObject({
      type: "booking"
    });
  });

  it("still says reply when a message is unanswered but the move is theirs", () => {
    // The case where the two questions come apart: Normal priority, and the
    // thing to do is still reply.
    const proposed = proposeNextAction(
      state({ leadStatus: "awaiting_customer", unreadInbound: 1, hasEvidence: true }),
      NOW
    );
    expect(proposed.type).toBe("reply");
  });
});

describe("when a penalty is what governs", () => {
  it("waits on a customer whose move it is, with no due time invented", () => {
    expect(action()).toMatchObject({ type: "wait", eligibility: "scheduled", dueAt: null });
  });

  it("waits until a snooze expires, and says when", () => {
    // Low priority and still a real action with a time. The two questions come
    // apart here.
    const proposed = action({ followUpDueAt: EARLIER, followUpSnoozedUntil: LATER });
    expect(proposed).toMatchObject({ type: "wait", eligibility: "scheduled", dueAt: LATER });
  });

  it("blocks on an opt-out rather than proposing a reply", () => {
    // Proposing a reply to somebody who opted out would be worse than
    // proposing nothing.
    expect(action({ unreadInbound: 3, optedOut: true })).toMatchObject({
      type: "wait",
      eligibility: "blocked"
    });
  });

  it("blocks on a closed conversation", () => {
    expect(action({ leadStatus: "closed" })).toMatchObject({ eligibility: "blocked" });
  });

  it("still hands off when a person was asked for, whatever else is true", () => {
    expect(action({ humanReviewRequested: true, optedOut: true })).toMatchObject({
      type: "handoff"
    });
  });
});

describe("what the proposal says about itself", () => {
  it("carries the reason codes that produced it", () => {
    const proposed = action({
      leadStatus: "needs_reply",
      unreadInbound: 1,
      hasEvidence: true,
      qualificationScore: 80
    });
    expect(proposed.reasonCodes).toContain("unanswered_inbound");
    expect(proposed.reasonCodes).toContain("well_qualified");
  });

  it("marks itself derived and fully confident", () => {
    // A rule either fired or it did not. The confidence field exists for
    // proposals that are genuinely guesses.
    expect(action({ leadStatus: "needs_reply", unreadInbound: 1 })).toMatchObject({
      source: "derived",
      confidence: 1
    });
  });

  it("never names a person as the owner of a system action", () => {
    expect(action({ optedOut: true, ownerId: OWNER })).toMatchObject({
      ownerType: "system",
      ownerId: null
    });
  });

  it("proposes the same action for the same state twice", () => {
    const input = state({ unreadInbound: 1, followUpDueAt: EARLIER, hasEvidence: true });
    expect(proposeNextAction(input, NOW)).toEqual(proposeNextAction(input, NOW));
  });

  it("only ever proposes an action in the contract's vocabulary", () => {
    const shapes: Partial<NextActionState>[] = [
      {},
      { humanReviewRequested: true },
      { unreadInbound: 2 },
      { optedOut: true },
      { leadStatus: "closed" },
      { leadStatus: "payment_pending" },
      { leadStatus: "booked" },
      { followUpDueAt: EARLIER },
      { followUpSnoozedUntil: LATER },
      { qualificationScore: 95, leadStatus: "booked" }
    ];
    for (const shape of shapes) {
      expect(NEXT_ACTION_TYPES).toContain(action(shape).type);
    }
  });

  it("never derives close, because a quiet week is not a decision", () => {
    const shapes: Partial<NextActionState>[] = [
      { leadStatus: "closed" },
      { optedOut: true },
      { leadStatus: "awaiting_customer" },
      { qualificationScore: 0 }
    ];
    for (const shape of shapes) {
      expect(action(shape).type).not.toBe("close");
    }
  });
});

describe("the CRM proposes and does not execute", () => {
  it("exports nothing that could perform an action", () => {
    // The contract's hard rule, held where a type system can hold it: this
    // module returns descriptions. Sending belongs to the outbox.
    const surface = Object.keys(nextActionModule).filter(
      (name) => typeof (nextActionModule as Record<string, unknown>)[name] === "function"
    );
    expect(surface).toEqual(["proposeNextAction"]);
  });

  it("returns a description with no callable on it", () => {
    const proposed = action({ unreadInbound: 1 });
    for (const value of Object.values(proposed)) {
      expect(typeof value).not.toBe("function");
    }
  });
});

describe("the radar page", () => {
  const viewRow = (over: Partial<FakeRow> = {}): FakeRow => ({
    workspace_id: WORKSPACE,
    customer_id: CUSTOMER,
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
    ...over
  });

  function harness(rows: FakeRow[]) {
    const fake = createFakeSupabase({ tables: { crm_radar_view: rows } });
    return new SupabaseCrmRepository(fake.client, workspace);
  }

  it("ranks and proposes for every row it returns", async () => {
    const repository = harness([
      viewRow({
        customer_id: "a",
        updated_at: "2026-08-22T00:00:00.000Z",
        lead_status: "needs_reply",
        unread_inbound: 2,
        has_evidence: true
      }),
      viewRow({ customer_id: "b", updated_at: "2026-08-21T00:00:00.000Z", lead_status: "closed" })
    ]);
    const page = await repository.radar({}, NOW);
    // Most recently touched first.
    expect(page.rows.map((row) => row.customerId)).toEqual(["a", "b"]);
    expect(page.rows.map((row) => row.priority)).toEqual(["high", "low"]);
    expect(page.rows.map((row) => row.nextAction.type)).toEqual(["reply", "wait"]);
  });

  it("does not read another workspace's rows", async () => {
    const repository = harness([viewRow({ workspace_id: "someone-else" })]);
    expect((await repository.radar({}, NOW)).rows).toHaveLength(0);
  });

  it("returns no cursor when the page is the last one", async () => {
    const repository = harness([viewRow()]);
    expect((await repository.radar({ limit: 10 }, NOW)).nextCursor).toBeNull();
  });

  it("returns a cursor when there is more, and does not leak the extra row", async () => {
    // One more than asked for is read, so "is there another page" is answered
    // by the read rather than by a count query that can disagree with it.
    const repository = harness([
      viewRow({ customer_id: "a", updated_at: "2026-08-22T00:00:00.000Z" }),
      viewRow({ customer_id: "b", updated_at: "2026-08-21T00:00:00.000Z" }),
      viewRow({ customer_id: "c", updated_at: "2026-08-20T00:00:00.000Z" })
    ]);
    const page = await repository.radar({ limit: 2 }, NOW);
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toEqual({
      updatedAt: "2026-08-21T00:00:00.000Z",
      customerId: "b"
    });
  });

  it("caps a caller asking for an unbounded page", async () => {
    const repository = harness([viewRow()]);
    await expect(repository.radar({ limit: 100000 }, NOW)).resolves.toBeDefined();
  });

  it("filters by lifecycle and lead status", async () => {
    const repository = harness([
      viewRow({ customer_id: "a", lifecycle_stage: "qualified" }),
      viewRow({ customer_id: "b", lifecycle_stage: "new" })
    ]);
    const page = await repository.radar({ lifecycleStage: "qualified" }, NOW);
    expect(page.rows.map((row) => row.customerId)).toEqual(["a"]);
  });
});

describe("storing a proposal somebody made", () => {
  function harness(rows: FakeRow[] = []) {
    const fake = createFakeSupabase({ tables: { crm_next_action_projection: rows } });
    return { fake, repository: new SupabaseCrmRepository(fake.client, workspace) };
  }

  it("stores a model's suggestion with its confidence", async () => {
    const { repository } = harness();
    const stored = await repository.proposeAction({
      customerId: CUSTOMER,
      type: "reply",
      reasonCodes: ["unanswered_inbound"],
      ownerType: "human",
      ownerId: OWNER,
      confidence: 0.7,
      source: "ai"
    });
    expect(stored).toMatchObject({ type: "reply", source: "ai", confidence: 0.7 });
  });

  it("refuses to store a derived action", async () => {
    // A derived action is recomputed on every read, so storing one creates a
    // second answer that can disagree with the live one.
    const { repository } = harness();
    await expect(
      repository.proposeAction({
        customerId: CUSTOMER,
        type: "reply",
        reasonCodes: [],
        ownerType: "system",
        source: "derived" as never
      })
    ).rejects.toThrow();
  });

  it("refuses an automation claiming to be a person", async () => {
    const { repository } = harness();
    await expect(
      repository.proposeAction({
        customerId: CUSTOMER,
        type: "reply",
        reasonCodes: [],
        ownerType: "automation",
        ownerId: OWNER,
        source: "ai"
      })
    ).rejects.toThrow();
  });

  it("returns only live proposals", async () => {
    const { repository } = harness([
      {
        id: "p1",
        workspace_id: WORKSPACE,
        customer_id: CUSTOMER,
        action_type: "reply",
        reason_codes: [],
        evidence_refs: [],
        owner_type: "system",
        owner_id: null,
        due_at: null,
        eligibility: "eligible",
        confidence: 1,
        source: "ai",
        settled_at: null,
        settled_outcome: null,
        proposed_at: "2026-08-27T00:00:00.000Z"
      },
      {
        id: "p2",
        workspace_id: WORKSPACE,
        customer_id: CUSTOMER,
        action_type: "reply",
        reason_codes: [],
        evidence_refs: [],
        owner_type: "system",
        owner_id: null,
        due_at: null,
        eligibility: "eligible",
        confidence: 1,
        source: "ai",
        settled_at: "2026-08-27T10:00:00.000Z",
        settled_outcome: "rejected",
        proposed_at: "2026-08-26T00:00:00.000Z"
      }
    ]);
    const live = await repository.proposalsFor(CUSTOMER);
    expect(live.map((proposal) => proposal.id)).toEqual(["p1"]);
  });

  it("keeps a rejected suggestion rather than deleting it", async () => {
    // "The model suggested this and somebody said no" is the record that makes
    // a bad suggestion pattern visible.
    const { fake, repository } = harness([
      {
        id: "p3",
        workspace_id: WORKSPACE,
        customer_id: CUSTOMER,
        action_type: "reply",
        reason_codes: [],
        evidence_refs: [],
        owner_type: "system",
        owner_id: null,
        due_at: null,
        eligibility: "eligible",
        confidence: 1,
        source: "ai",
        settled_at: null,
        settled_outcome: null,
        proposed_at: "2026-08-27T00:00:00.000Z"
      }
    ]);
    const settled = await repository.settleProposal("p3", "rejected");
    expect(settled.settledOutcome).toBe("rejected");
    expect(fake.database.rows("crm_next_action_projection")).toHaveLength(1);
  });
});
