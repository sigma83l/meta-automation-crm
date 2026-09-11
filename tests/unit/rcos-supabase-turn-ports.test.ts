import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createFakeSupabase,
  type FakeRow,
  type FakeRpcHandler
} from "@/tests/fixtures/fake-supabase";
import type { ProposedFact } from "@/src/modules/rcos/memory-policy";
import {
  createDraftRegistry,
  createSupabaseTurnPorts,
  type SupabaseTurnDependencies
} from "@/src/modules/rcos/supabase-turn-ports";
import type { ComposedReply, TurnEvent, TurnRecord } from "@/src/modules/rcos/turn-engine";

/**
 * The durable half of the turn.
 *
 * These are the ports the engine's guarantees actually rest on: deduplication
 * that survives a redeploy, a commit that happens before a send, and a send
 * that refuses by default. The pure engine tests cannot reach any of it,
 * because all three are statements about a database.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";

const event: TurnEvent = {
  eventId: "evt-1",
  workspaceId: WORKSPACE,
  conversationId: CONVERSATION,
  channel: "whatsapp",
  text: "how much is a consultation?",
  occurredAt: "2026-08-19T10:00:00.000Z"
};

const record = (over: Partial<TurnRecord> = {}): TurnRecord => ({
  eventId: event.eventId,
  workspaceId: WORKSPACE,
  conversationId: CONVERSATION,
  outcome: "sent",
  reasonCodes: ["answer_from_knowledge"],
  acceptedMemoryWrites: 0,
  refusedMemoryWrites: 0,
  toolExecuted: false,
  ...over
});

const openConversation: FakeRow = {
  id: CONVERSATION,
  workspace_id: WORKSPACE,
  customer_id: CUSTOMER,
  state: "open",
  owner: "automation",
  requires_human_review: false
};

const activeTrial: FakeRow = {
  workspace_id: WORKSPACE,
  status: "trialing",
  trial_ends_at: "2099-01-01T00:00:00.000Z",
  current_period_ends_at: null
};

function harness(
  over: Partial<{
    tables: Record<string, FakeRow[]>;
    send: SupabaseTurnDependencies["send"];
    draft: ComposedReply;
    connectionMode: "sandbox" | "live";
    escalationKeywords: readonly string[];
    lowConfidenceThreshold: number;
    admin: SupabaseClient;
    rpc: Record<string, FakeRpcHandler>;
  }> = {}
) {
  const fake = createFakeSupabase({
    ...(over.rpc ? { rpc: over.rpc } : {}),
    tables: over.tables ?? {
      conversations: [openConversation],
      workspace_subscriptions: [activeTrial],
      turn_records: [],
      messages: [],
      ai_execution_audit_events: []
    }
  });
  const drafts = createDraftRegistry();
  if (over.draft) drafts.record(event.eventId, over.draft);

  const ports = createSupabaseTurnPorts({
    admin: over.admin ?? fake.client,
    subject: {
      customerId: CUSTOMER,
      recipientRef: "905551112233",
      connectionMode: over.connectionMode ?? "sandbox"
    },
    send: over.send ?? {
      liveSendEnabled: false,
      recipientAllowlist: [],
      explicitApproval: false
    },
    decisionContext: async () => ({
      escalationKeywords: over.escalationKeywords ?? [],
      lowConfidenceThreshold: over.lowConfidenceThreshold ?? 0.5
    }),
    draft: (id) => drafts.get(id)
  });

  return { fake, ports, drafts };
}

describe("deduplication", () => {
  it("treats an event with no turn record as new", async () => {
    const { ports } = harness();
    expect(await ports.isNewEvent(event)).toBe(true);
  });

  it("treats an event it has already committed as handled", async () => {
    const { ports } = harness();
    await ports.commit(record());
    expect(await ports.isNewEvent(event)).toBe(false);
  });

  it("scopes the check to the workspace", async () => {
    const { ports } = harness();
    await ports.commit(record());
    // The same provider event id under a different tenant is a different event.
    expect(await ports.isNewEvent({ ...event, workspaceId: "other" })).toBe(true);
  });
});

describe("policy, before any model is called", () => {
  it("permits a turn on an open, automated, entitled conversation", async () => {
    const { ports } = harness();
    expect(await ports.evaluatePolicy(event)).toEqual({ canSend: true, allowedActions: [] });
  });

  it("refuses when a person has taken the conversation", async () => {
    const { ports } = harness({
      tables: {
        conversations: [{ ...openConversation, owner: "human" }],
        workspace_subscriptions: [activeTrial]
      }
    });
    const policy = await ports.evaluatePolicy(event);
    expect(policy.canSend).toBe(false);
    expect(policy.blockedReason).toBe("human_takeover");
  });

  it("refuses on a closed conversation", async () => {
    const { ports } = harness({
      tables: {
        conversations: [{ ...openConversation, state: "closed" }],
        workspace_subscriptions: [activeTrial]
      }
    });
    expect((await ports.evaluatePolicy(event)).blockedReason).toBe("conversation_closed");
  });

  it("refuses when the trial has lapsed", async () => {
    const { ports } = harness({
      tables: {
        conversations: [openConversation],
        workspace_subscriptions: [{ ...activeTrial, trial_ends_at: "2020-01-01T00:00:00.000Z" }]
      }
    });
    // Checked before the model so an unentitled workspace costs nothing to
    // refuse. The customer's message is stored regardless.
    expect((await ports.evaluatePolicy(event)).blockedReason).toBe("billing_entitlement_required");
  });

  it("refuses when the workspace has no subscription row at all", async () => {
    const { ports } = harness({
      tables: { conversations: [openConversation], workspace_subscriptions: [] }
    });
    expect((await ports.evaluatePolicy(event)).blockedReason).toBe("billing_entitlement_required");
  });

  it("refuses when this workspace's assistant replies are switched off", async () => {
    const { ports } = harness({
      tables: {
        conversations: [openConversation],
        workspace_subscriptions: [activeTrial],
        workspace_feature_overrides: [
          { workspace_id: WORKSPACE, flag_key: "ai_replies", enabled: false, expires_at: null }
        ]
      }
    });
    expect((await ports.evaluatePolicy(event)).blockedReason).toBe("ai_replies_disabled");
  });

  it("keeps replying under an override that has expired", async () => {
    // A time-boxed staff override is a loan, not a setting. If an expired row
    // still blocked, a support action taken during one incident would go on
    // silently withholding the capability long after it was returned.
    const { ports } = harness({
      tables: {
        conversations: [openConversation],
        workspace_subscriptions: [activeTrial],
        workspace_feature_overrides: [
          {
            workspace_id: WORKSPACE,
            flag_key: "ai_replies",
            enabled: false,
            expires_at: "2020-01-01T00:00:00.000Z"
          }
        ]
      }
    });
    expect((await ports.evaluatePolicy(event)).canSend).toBe(true);
  });

  it("refuses when replies are paused platform-wide", async () => {
    const { ports } = harness({
      tables: {
        conversations: [openConversation],
        workspace_subscriptions: [activeTrial],
        platform_switches: [{ key: "ai_replies", enabled: false }]
      }
    });
    // A different reason from the one above, because the two have different
    // owners and different fixes: one is a conversation about the plan, the
    // other is us, and only one of them resolves on its own.
    expect((await ports.evaluatePolicy(event)).blockedReason).toBe("ai_replies_paused");
  });

  it("reports the lapsed subscription rather than the flag when both are true", async () => {
    const { ports } = harness({
      tables: {
        conversations: [openConversation],
        workspace_subscriptions: [{ ...activeTrial, trial_ends_at: "2020-01-01T00:00:00.000Z" }],
        platform_switches: [{ key: "ai_replies", enabled: false }]
      }
    });
    // Ours is not the reason to give somebody who can act on theirs.
    expect((await ports.evaluatePolicy(event)).blockedReason).toBe("billing_entitlement_required");
  });

  it("refuses when the flag cannot be resolved at all", async () => {
    // An empty catalogue stands in for a read that answered nothing. A turn
    // that cannot establish permission does not get a model; it gets a person.
    const { ports } = harness({
      tables: {
        conversations: [openConversation],
        workspace_subscriptions: [activeTrial],
        feature_flags: []
      }
    });
    expect((await ports.evaluatePolicy(event)).blockedReason).toBe("ai_replies_disabled");
  });

  it("never offers an action, so no tool can be authorised", async () => {
    const { ports } = harness();
    expect((await ports.evaluatePolicy(event)).allowedActions).toEqual([]);
  });
});

describe("deciding", () => {
  const understanding = (confidence: number) => ({
    intents: [{ name: "pricing", confidence }],
    locale: "en"
  });

  it("answers a confident turn", async () => {
    const { ports } = harness();
    const decision = await ports.decide(event, understanding(0.9));
    expect(decision.type).toBe("answer");
  });

  it("hands off below the workspace's own confidence threshold", async () => {
    const { ports } = harness({ lowConfidenceThreshold: 0.8 });
    const decision = await ports.decide(event, understanding(0.6));
    expect(decision).toMatchObject({ type: "handoff", reasonCodes: ["low_confidence"] });
  });

  it("hands off on a workspace escalation keyword whatever the confidence", async () => {
    // The workspace listed the word; that decision outranks how sure this
    // particular turn happens to feel.
    const { ports } = harness({ escalationKeywords: ["consultation"] });
    const decision = await ports.decide(event, understanding(1));
    expect(decision).toMatchObject({
      type: "handoff",
      priority: "p0_safety_policy",
      reasonCodes: ["escalation_keyword"]
    });
  });

  it("ignores an empty keyword rather than matching everything", async () => {
    const { ports } = harness({ escalationKeywords: ["", "   "] });
    expect((await ports.decide(event, understanding(0.9))).type).toBe("answer");
  });
});

describe("committing", () => {
  it("records the outcome of a refused turn, not only a sent one", async () => {
    const { fake, ports } = harness();
    await ports.commit(record({ outcome: "handoff", reasonCodes: ["empty_draft"] }));
    const rows = fake.database.rows("turn_records");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "handoff", reason_codes: ["empty_draft"] });
  });

  it("writes the outbound message before anything could send it", async () => {
    const { fake, ports } = harness({
      draft: { text: "A consultation is 1200 TL.", citedRefs: ["price-1"], claimsCompletion: false }
    });
    await ports.commit(record());
    const messages = fake.database.rows("messages");
    expect(messages).toHaveLength(1);
    // 'prepared', not 'sent': nothing has contacted a provider at this point,
    // and the status must not claim otherwise.
    expect(messages[0]).toMatchObject({
      direction: "outbound",
      status: "prepared",
      body: "A consultation is 1200 TL.",
      customer_id: CUSTOMER
    });
  });

  it("uses the send ref as the outbound provider id so a replay collides", async () => {
    const { fake, ports } = harness({
      draft: { text: "Sure.", citedRefs: [], claimsCompletion: false }
    });
    await ports.commit(record());
    expect(fake.database.rows("messages")[0]!.provider_message_id).toBe(
      `${CONVERSATION}:${event.eventId}`
    );
  });

  it("writes no outbound message for a turn that was not sent", async () => {
    const { fake, ports } = harness({
      draft: { text: "", citedRefs: [], claimsCompletion: false }
    });
    await ports.commit(record({ outcome: "handoff" }));
    expect(fake.database.rows("messages")).toHaveLength(0);
  });

  it("puts a handoff in front of a person", async () => {
    const { fake, ports } = harness();
    await ports.commit(record({ outcome: "handoff", reasonCodes: ["low_confidence"] }));
    // A handoff nobody can see is not a handoff. This flag is what surfaces it
    // in the inbox.
    expect(fake.database.rows("conversations")[0]!.requires_human_review).toBe(true);
  });

  it("leaves the review flag alone for an ordinary sent turn", async () => {
    const { fake, ports } = harness({
      draft: { text: "Sure.", citedRefs: [], claimsCompletion: false }
    });
    await ports.commit(record());
    expect(fake.database.rows("conversations")[0]!.requires_human_review).toBe(false);
  });
});

describe("sending", () => {
  const reply: ComposedReply = { text: "Sure.", citedRefs: [], claimsCompletion: false };

  it("does not send on a sandbox connection", async () => {
    const { ports } = harness({ connectionMode: "sandbox" });
    await expect(ports.send(reply, "ref-1")).resolves.toBeUndefined();
  });

  it("does not send on a live connection while the environment gate is closed", async () => {
    const { ports } = harness({
      connectionMode: "live",
      send: { liveSendEnabled: false, recipientAllowlist: ["905551112233"], explicitApproval: true }
    });
    // Blocked is a resting state, not an error: the reply stays 'prepared'.
    await expect(ports.send(reply, "ref-1")).resolves.toBeUndefined();
  });

  it("does not send to a recipient outside the allowlist", async () => {
    const { ports } = harness({
      connectionMode: "live",
      send: { liveSendEnabled: true, recipientAllowlist: ["905550000000"], explicitApproval: true }
    });
    await expect(ports.send(reply, "ref-1")).resolves.toBeUndefined();
  });

  it("refuses loudly when every gate is open and no adapter exists", async () => {
    const { ports } = harness({
      connectionMode: "live",
      send: { liveSendEnabled: true, recipientAllowlist: ["905551112233"], explicitApproval: true }
    });
    // The alternative is returning quietly, which would make a build with no
    // outbound adapter indistinguishable from one that works.
    await expect(ports.send(reply, "ref-1")).rejects.toThrow(/LIVE_SEND_ADAPTER_MISSING/);
  });
});

describe("send refs", () => {
  it("reports only refs from turns that reached the send step", async () => {
    const { ports } = harness();
    await ports.commit(record({ outcome: "sent" }));
    await ports.commit(
      record({ eventId: "evt-2", outcome: "handoff", reasonCodes: ["empty_draft"] })
    );
    expect(await ports.sentRefs(event)).toEqual([`${CONVERSATION}:${event.eventId}`]);
  });
});

describe("observation", () => {
  it("records the outcome without the message or the draft", async () => {
    const { fake, ports } = harness({
      draft: { text: "A consultation is 1200 TL.", citedRefs: [], claimsCompletion: false }
    });
    await ports.observe(record({ outcome: "handoff", reasonCodes: ["low_confidence"] }));
    const rows = fake.database.rows("ai_execution_audit_events");
    expect(rows).toHaveLength(1);
    const serialised = JSON.stringify(rows[0]);
    expect(serialised).toContain("low_confidence");
    expect(serialised).not.toContain("1200");
    expect(serialised).not.toContain("consultation");
  });
});

describe("memory", () => {
  it("hydrates nothing, because there is nowhere to hydrate from", async () => {
    // Deliberate and visible: no contact-facts table exists in this schema.
    // Synthesising facts from the conversation would put unreviewed model
    // output into the one store the memory policy exists to keep honest.
    const { ports } = harness();
    expect(await ports.hydrate(event)).toEqual({ facts: [] });
  });
});

describe("tools", () => {
  it("throws rather than pretending, since none are registered", async () => {
    const { ports } = harness();
    await expect(
      ports.executeTool({ actionName: "book", actionClass: "business_transaction" })
    ).rejects.toThrow("NO_TOOLS_REGISTERED");
  });
});

describe("memory hydration", () => {
  const fact = (over: Partial<FakeRow> = {}): FakeRow => ({
    workspace_id: WORKSPACE,
    customer_id: CUSTOMER,
    fact_key: "preferred_time",
    fact_value: "mornings",
    confidence: "confirmed",
    source_ref: "msg-1",
    recorded_at: "2026-08-20T10:00:00.000Z",
    valid_until: null,
    ...over
  });

  it("reads stored facts for this customer", async () => {
    // The table matched StoredFact column for column and nothing read it, so
    // the engine counted memory writes and hydrated nothing.
    const { ports } = harness({
      tables: {
        conversations: [openConversation],
        workspace_subscriptions: [activeTrial],
        contact_facts: [fact()]
      }
    });
    const { facts } = await ports.hydrate(event);
    expect(facts).toEqual([
      {
        key: "preferred_time",
        value: "mornings",
        confidence: "confirmed",
        sourceRef: "msg-1",
        recordedAt: "2026-08-20T10:00:00.000Z",
        validUntil: null
      }
    ]);
  });

  it("does not read another workspace's facts", async () => {
    const { ports } = harness({
      tables: {
        conversations: [openConversation],
        workspace_subscriptions: [activeTrial],
        contact_facts: [fact({ workspace_id: "someone-else" })]
      }
    });
    expect((await ports.hydrate(event)).facts).toEqual([]);
  });

  it("does not read another customer's facts", async () => {
    const { ports } = harness({
      tables: {
        conversations: [openConversation],
        workspace_subscriptions: [activeTrial],
        contact_facts: [fact({ customer_id: "another-customer" })]
      }
    });
    expect((await ports.hydrate(event)).facts).toEqual([]);
  });

  it("returns nothing rather than failing the turn when the read errors", async () => {
    // The customer's message is stored either way. A turn without memory beats
    // no turn at all.
    const { ports } = harness({
      tables: { conversations: [openConversation], workspace_subscriptions: [activeTrial] }
    });
    expect((await ports.hydrate(event)).facts).toEqual([]);
  });
});

describe("persisting accepted facts", () => {
  const proposed = (over: Partial<ProposedFact> = {}): ProposedFact => ({
    key: "preferred_time",
    value: "mornings",
    confidence: "confirmed",
    sourceRef: "msg-1",
    recordedAt: "2026-08-20T10:00:00.000Z",
    ...over
  });

  it("stores a fact against this workspace and customer", async () => {
    const { fake, ports } = harness();
    expect(await ports.persistFacts(event, [proposed()])).toBe(1);
    expect(fake.database.rows("contact_facts")).toEqual([
      expect.objectContaining({
        workspace_id: WORKSPACE,
        customer_id: CUSTOMER,
        fact_key: "preferred_time",
        fact_value: "mornings",
        confidence: "confirmed",
        source_ref: "msg-1",
        recorded_at: "2026-08-20T10:00:00.000Z",
        valid_until: null
      })
    ]);
  });

  it("what it stores is what the next turn hydrates", async () => {
    // The two halves are only useful if they agree on the column mapping, and
    // a round trip is the one assertion that fails when they drift apart.
    const { ports } = harness();
    const fact = proposed({ validUntil: "2026-12-01T00:00:00.000Z" });
    await ports.persistFacts(event, [fact]);
    expect((await ports.hydrate(event)).facts).toEqual([fact]);
  });

  it("replaces the value for a key rather than adding a second row", async () => {
    // One row per key per customer is the table's own constraint; a conflict
    // target that missed it would give a customer two budgets.
    const { fake, ports } = harness();
    await ports.persistFacts(event, [proposed({ value: "mornings" })]);
    await ports.persistFacts(event, [proposed({ value: "evenings" })]);
    const rows = fake.database.rows("contact_facts");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fact_value: "evenings" });
  });

  it("keeps another customer's fact under the same key", async () => {
    const { fake, ports } = harness();
    await ports.persistFacts(event, [proposed()]);
    fake.database.rows("contact_facts").push({
      workspace_id: WORKSPACE,
      customer_id: "another-customer",
      fact_key: "preferred_time",
      fact_value: "evenings"
    });
    await ports.persistFacts(event, [proposed({ value: "afternoons" })]);
    expect(fake.database.rows("contact_facts")).toHaveLength(2);
  });

  it("writes nothing when there is nothing to write", async () => {
    const { fake, ports } = harness();
    expect(await ports.persistFacts(event, [])).toBe(0);
    expect(fake.database.rows("contact_facts")).toEqual([]);
  });

  it("reports zero rather than throwing when the write fails", async () => {
    // The engine turns a short count into `memory_write_failed` on the turn
    // record. Throwing would cost the customer a reply over a fact the next
    // message can re-observe.
    const failing = {
      from: () => ({
        upsert: async () => ({ data: null, error: { code: "42501", message: "denied" } })
      })
    } as unknown as SupabaseClient;
    const { ports } = harness({ admin: failing });
    expect(await ports.persistFacts(event, [proposed()])).toBe(0);
  });
});

describe("the AI allowance, spent", () => {
  const GROWTH_LIMITS = {
    price_minor_units: 4500,
    mac: 2500,
    ai_work_units: 3000,
    automation_actions: 15000,
    connector_units: 5000,
    seats: 3,
    storage_mb: 10240
  };
  const CYCLE = "44444444-4444-4444-8444-444444444444";

  function cappedHarness(
    totals: readonly { meter: string; total: number }[],
    options: {
      limits?: Record<string, unknown> | null;
      totalsError?: boolean;
      cycle?: boolean;
    } = {}
  ) {
    return harness({
      tables: {
        conversations: [openConversation],
        workspace_subscriptions: [
          {
            ...activeTrial,
            subscription_plans: options.limits === undefined ? GROWTH_LIMITS : options.limits
          }
        ],
        billing_cycles:
          options.cycle === false ? [] : [{ id: CYCLE, workspace_id: WORKSPACE, closed_at: null }],
        turn_records: [],
        messages: [],
        ai_execution_audit_events: []
      },
      rpc: {
        usage_totals_for_cycle: () =>
          options.totalsError
            ? {
                data: null,
                error: { code: "PGRST000", message: "ledger unavailable" },
                count: null
              }
            : { data: totals, error: null, count: null }
      }
    });
  }

  it("refuses before any model runs once the allowance is gone", async () => {
    // At step 4 on purpose. A cap found after the work has already cost the
    // customer a reply they cannot unsend, and cost us the tokens for it.
    const { ports } = cappedHarness([{ meter: "ai_work_units", total: 3000 }]);
    const policy = await ports.evaluatePolicy(event);
    expect(policy.canSend).toBe(false);
    expect(policy.blockedReason).toBe("usage_cap_reached");
  });

  it("permits a turn while there is room for even the cheapest reply", async () => {
    const { ports } = cappedHarness([{ meter: "ai_work_units", total: 2999 }]);
    expect((await ports.evaluatePolicy(event)).canSend).toBe(true);
  });

  it("treats an unrecorded allowance as fair use, not as zero", async () => {
    // Business and Agency record no number for some meters. Reading absent as
    // zero would stop exactly the plans sold as unmetered.
    const { ports } = cappedHarness([{ meter: "ai_work_units", total: 99999 }], {
      limits: { ...GROWTH_LIMITS, ai_work_units: null }
    });
    expect((await ports.evaluatePolicy(event)).canSend).toBe(true);
  });

  it("permits the turn when the ledger cannot be read", async () => {
    // The one refusal here that fails open, and the asymmetry is deliberate:
    // wrongly blocking costs a paying customer a reply they are entitled to,
    // wrongly allowing costs us a few units we under-bill. A ledger we cannot
    // read is our fault.
    const { ports } = cappedHarness([], { totalsError: true });
    expect((await ports.evaluatePolicy(event)).canSend).toBe(true);
  });

  it("permits the turn when no cycle is open, because nothing has been spent", async () => {
    const { ports } = cappedHarness([{ meter: "ai_work_units", total: 99999 }], { cycle: false });
    expect((await ports.evaluatePolicy(event)).canSend).toBe(true);
  });

  it("still refuses for a reason the customer can act on first", async () => {
    // Entitlement outranks the cap: a lapsed subscription is the thing they can
    // fix, and reporting ours instead would hide it.
    const { ports } = harness({
      tables: {
        conversations: [openConversation],
        workspace_subscriptions: [
          {
            ...activeTrial,
            trial_ends_at: "2020-01-01T00:00:00.000Z",
            subscription_plans: GROWTH_LIMITS
          }
        ],
        billing_cycles: [{ id: CYCLE, workspace_id: WORKSPACE, closed_at: null }],
        turn_records: [],
        messages: [],
        ai_execution_audit_events: []
      },
      rpc: {
        usage_totals_for_cycle: () => ({
          data: [{ meter: "ai_work_units", total: 3000 }],
          error: null,
          count: null
        })
      }
    });
    expect((await ports.evaluatePolicy(event)).blockedReason).toBe("billing_entitlement_required");
  });
});
