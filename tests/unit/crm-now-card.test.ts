import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeRow } from "@/tests/fixtures/fake-supabase";
import { SupabaseCrmRepository } from "@/src/modules/crm/adapters/supabase-crm-repository";
import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import { NOW_FACT_KEYS, buildNowCard, type NowCardInput } from "@/src/modules/crm/now-card";
import type { StoredFact } from "@/src/modules/rcos/memory-policy";

/**
 * The Now card.
 *
 * Its rule is one sentence and every test here is a way of breaking it: never
 * manufacture completeness. A card that quietly omits what it does not know
 * reads as a complete picture of the customer, and an operator acts on it. So
 * the cases that matter are the absences - no memory, an expired fact, no
 * score, no messages - and what the card says when it has nothing to say.
 */

const NOW = new Date("2026-08-28T12:00:00.000Z");
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const OWNER = "55555555-5555-4555-8555-555555555555";

const workspace: TrustedWorkspace = {
  id: WORKSPACE,
  name: "Probe",
  userId: OWNER,
  role: "operator"
};

const fact = (over: Partial<StoredFact> = {}): StoredFact => ({
  key: NOW_FACT_KEYS.intent,
  value: "A quote for 200 units",
  confidence: "confirmed",
  sourceRef: "msg-1",
  recordedAt: "2026-08-27T00:00:00.000Z",
  validUntil: null,
  ...over
});

const input = (over: Partial<NowCardInput> = {}): NowCardInput => ({
  state: {
    leadStatus: "awaiting_customer",
    lifecycleStage: "engaged",
    unreadInbound: 0,
    humanReviewRequested: false,
    optedOut: false
  },
  facts: [],
  score: null,
  lastMessage: null,
  handling: null,
  ...over
});

const card = (over: Partial<NowCardInput> = {}) => buildNowCard(input(over), NOW);

describe("what the card says when it knows nothing", () => {
  it("says unknown rather than leaving a field out", () => {
    const empty = card();
    expect(empty.currentIntent).toBeNull();
    expect(empty.desiredOutcome).toBeNull();
    expect(empty.score).toBeNull();
    expect(empty.strongestEvidence).toBeNull();
    expect(empty.strongestBlocker).toBeNull();
    expect(empty.lastMessage).toBeNull();
    expect(empty.dataConfidence).toBeNull();
    expect(empty.handling).toBeNull();
  });

  it("still says what to do, because that is derived and not remembered", () => {
    // The card is allowed to be empty. It is not allowed to be silent about the
    // one thing current state can always answer - here, that the move is
    // theirs and the action is to wait.
    const empty = card();
    expect(empty.nextAction.type).toBe("wait");
    // Nothing outstanding is Low, and that is the correct answer rather than a
    // missing one.
    expect(empty.attention.priority).toBe("low");
    expect(empty.lifecycleStage).toBe("engaged");
    expect(empty.leadStatus).toBe("awaiting_customer");
  });
});

describe("a value the card shows carries where it came from", () => {
  it("links a remembered need to the message it came from", () => {
    const shown = card({ facts: [fact()] });
    expect(shown.currentIntent).toEqual({
      value: "A quote for 200 units",
      evidence: { kind: "memory", ref: "msg-1" },
      confidence: "confirmed"
    });
  });

  it("links the score to the snapshot that produced it", () => {
    const shown = card({
      score: {
        id: "snap-1",
        score: 62,
        topDrivers: [{ component: "intent", contribution: 20 }],
        topBlockers: [{ component: "commitment", reason: "unevidenced", cost: 10 }],
        evidenceRefs: ["ev-1"]
      }
    });
    expect(shown.score).toEqual({ value: 62, evidence: { kind: "score", ref: "snap-1" } });
    expect(shown.strongestEvidence).toEqual({
      value: { component: "intent", contribution: 20 },
      evidence: { kind: "evidence", ref: "ev-1" }
    });
  });

  it("admits a blocker has nothing to link to", () => {
    // A blocker is an absence - points not earned. Inventing a reference for it
    // would be the manufactured completeness the whole card exists to refuse.
    const shown = card({
      score: {
        id: "snap-1",
        score: 10,
        topDrivers: [],
        topBlockers: [{ component: "financial_fit", reason: "unevidenced", cost: 15 }],
        evidenceRefs: []
      }
    });
    expect(shown.strongestBlocker?.value.component).toBe("financial_fit");
    expect(shown.strongestBlocker?.evidence).toBeNull();
  });

  it("takes the score engine's own ordering rather than re-ranking it", () => {
    const shown = card({
      score: {
        id: "snap-1",
        score: 40,
        topDrivers: [
          { component: "urgency", contribution: 5 },
          { component: "intent", contribution: 30 }
        ],
        topBlockers: [],
        evidenceRefs: ["ev-9"]
      }
    });
    // The engine said urgency first; the card does not overrule it, because a
    // card disagreeing with the score's account of itself discredits both.
    expect(shown.strongestEvidence?.value.component).toBe("urgency");
  });
});

describe("an expired memory is absent, not stale", () => {
  it("drops a need whose validity has passed", () => {
    const shown = card({
      facts: [fact({ validUntil: "2026-08-01T00:00:00.000Z" })]
    });
    expect(shown.currentIntent).toBeNull();
  });

  it("keeps one whose validity is still ahead", () => {
    const shown = card({ facts: [fact({ validUntil: "2026-09-01T00:00:00.000Z" })] });
    expect(shown.currentIntent?.value).toBe("A quote for 200 units");
  });
});

describe("how far the card can be trusted", () => {
  it("reports the weakest of its remembered values, not an average", () => {
    const shown = card({
      facts: [
        fact({ confidence: "human_verified" }),
        fact({ key: NOW_FACT_KEYS.outcome, value: "Ship by October", confidence: "inferred" })
      ]
    });
    // One guess in a card read as a single claim makes the whole thing a guess.
    expect(shown.dataConfidence).toBe("inferred");
  });

  it("says nothing when nothing has been established", () => {
    expect(card().dataConfidence).toBeNull();
  });

  it("does not fold the score's own confidence into it", () => {
    // Different scales. Combining them would produce a number neither could
    // defend.
    const shown = card({
      score: { id: "s", score: 90, topDrivers: [], topBlockers: [], evidenceRefs: [] }
    });
    expect(shown.dataConfidence).toBeNull();
  });
});

describe("whether anything is late", () => {
  it("calls an overdue follow-up overdue", () => {
    const shown = card({
      state: {
        leadStatus: "follow_up_due",
        lifecycleStage: "engaged",
        unreadInbound: 0,
        humanReviewRequested: false,
        followUpDueAt: "2026-08-27T00:00:00.000Z",
        optedOut: false
      }
    });
    expect(shown.dueState).toBe("overdue");
    expect(shown.attention.priority).toBe("high");
  });

  it("reads the state off the same verdict the priority came from", () => {
    // Not recomputed from timestamps: a second rule set here would eventually
    // disagree with the priority chip beside it. Three hours out is due soon by
    // the engine's window, and the card says the same.
    const shown = card({
      state: {
        leadStatus: "awaiting_customer",
        lifecycleStage: "engaged",
        unreadInbound: 0,
        humanReviewRequested: false,
        followUpDueAt: "2026-08-28T15:00:00.000Z",
        optedOut: false
      }
    });
    expect(shown.dueState).toBe("due_soon");
  });

  it("says nothing is due when nothing is", () => {
    expect(card().dueState).toBe("none");
  });
});

describe("the last message", () => {
  it("summarises without pretending to be the message", () => {
    const shown = card({
      lastMessage: {
        id: "m1",
        conversationId: "conv-1",
        direction: "inbound",
        body: `${"word ".repeat(60)}end`,
        sentAt: "2026-08-28T09:00:00.000Z"
      }
    });
    expect(shown.lastMessage?.value.excerpt.endsWith("…")).toBe(true);
    expect(shown.lastMessage?.value.excerpt.length).toBeLessThanOrEqual(161);
    expect(shown.lastMessage?.evidence).toEqual({ kind: "conversation", ref: "conv-1" });
  });

  it("leaves a short message alone", () => {
    const shown = card({
      lastMessage: {
        id: "m1",
        conversationId: "conv-1",
        direction: "outbound",
        body: "  Sent   the quote.\n",
        sentAt: "2026-08-28T09:00:00.000Z"
      }
    });
    expect(shown.lastMessage?.value.excerpt).toBe("Sent the quote.");
  });
});

describe("the repository assembles the card", () => {
  const radarRow: FakeRow = {
    workspace_id: WORKSPACE,
    customer_id: CUSTOMER,
    display_name: "Probe",
    company_name: null,
    status: "active",
    source: "manual",
    lifecycle_stage: "qualified",
    lead_status: "needs_reply",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
    score: 62,
    unread_inbound: 2,
    human_review_requested: false,
    followup_due_at: null,
    followup_snoozed_until: null,
    opted_out: false,
    has_evidence: true,
    owner_id: null,
    channel: "whatsapp",
    last_activity_at: "2026-08-28T00:00:00.000Z",
    current_need: null,
    current_need_confidence: null
  };

  function harness(over: Record<string, FakeRow[]> = {}) {
    const fake = createFakeSupabase({
      tables: {
        crm_radar_view: [radarRow],
        contact_facts: [],
        crm_score_snapshots: [],
        messages: [],
        conversations: [],
        ...over
      }
    });
    return new SupabaseCrmRepository(fake.client, workspace);
  }

  it("ranks the same state the index ranks", async () => {
    const shown = await harness().nowCardFor(CUSTOMER, NOW);
    expect(shown.leadStatus).toBe("needs_reply");
    expect(shown.attention.priority).toBe("high");
    expect(shown.nextAction.type).toBe("reply");
  });

  it("reads memory, the last message and who is handling it", async () => {
    const repository = harness({
      contact_facts: [
        {
          workspace_id: WORKSPACE,
          customer_id: CUSTOMER,
          fact_key: NOW_FACT_KEYS.intent,
          fact_value: "A quote for 200 units",
          confidence: "confirmed",
          source_ref: "msg-1",
          recorded_at: "2026-08-27T00:00:00.000Z",
          valid_until: null
        }
      ],
      messages: [
        {
          id: "m1",
          workspace_id: WORKSPACE,
          customer_id: CUSTOMER,
          conversation_id: "conv-1",
          direction: "inbound",
          body: "Can you send the quote?",
          sent_at: "2026-08-28T09:00:00.000Z"
        }
      ],
      conversations: [
        {
          id: "conv-1",
          workspace_id: WORKSPACE,
          customer_id: CUSTOMER,
          owner: "human",
          last_message_at: "2026-08-28T09:00:00.000Z"
        }
      ]
    });
    const shown = await repository.nowCardFor(CUSTOMER, NOW);
    expect(shown.currentIntent?.value).toBe("A quote for 200 units");
    expect(shown.lastMessage?.value.excerpt).toBe("Can you send the quote?");
    expect(shown.handling).toBe("human");
  });

  it("does not read another workspace's memory", async () => {
    const repository = harness({
      contact_facts: [
        {
          workspace_id: "someone-else",
          customer_id: CUSTOMER,
          fact_key: NOW_FACT_KEYS.intent,
          fact_value: "Not theirs",
          confidence: "confirmed",
          source_ref: "msg-9",
          recorded_at: "2026-08-27T00:00:00.000Z",
          valid_until: null
        }
      ]
    });
    expect((await repository.nowCardFor(CUSTOMER, NOW)).currentIntent).toBeNull();
  });

  it("refuses a contact this workspace cannot see", async () => {
    const fake = createFakeSupabase({ tables: { crm_radar_view: [] } });
    const repository = new SupabaseCrmRepository(fake.client, workspace);
    await expect(repository.nowCardFor(CUSTOMER, NOW)).rejects.toThrow("CUSTOMER_NOT_FOUND");
  });
});
