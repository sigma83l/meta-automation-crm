import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeRow } from "@/tests/fixtures/fake-supabase";
import { SupabaseCrmRepository } from "@/src/modules/crm/adapters/supabase-crm-repository";
import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import * as aiWrite from "@/src/modules/crm/ai-write";
import {
  classifyProposal,
  evidenceKey,
  summariseProposal,
  type AiCrmProposal,
  type CurrentCrmState
} from "@/src/modules/crm/ai-write";
import type { StoredFact } from "@/src/modules/rcos/memory-policy";

/**
 * What a model may say about a customer.
 *
 * The pack's closing rule is that the AI never executes SQL or an update by
 * field name; it emits an application-owned proposal. The tests that matter are
 * therefore about what the proposal cannot express and what the classification
 * refuses: a field nobody defined, a component outside the contract, a fact
 * weaker than the one on file, and the same observation offered twice.
 */

const NOW = new Date("2026-08-29T12:00:00.000Z");
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const OWNER = "55555555-5555-4555-8555-555555555555";

const workspace: TrustedWorkspace = {
  id: WORKSPACE,
  name: "Probe",
  userId: OWNER,
  role: "operator"
};

const stored = (over: Partial<StoredFact> = {}): StoredFact => ({
  key: "budget",
  value: "about 5k",
  confidence: "confirmed",
  sourceRef: "msg-1",
  recordedAt: "2026-08-20T00:00:00.000Z",
  validUntil: null,
  ...over
});

const state = (over: Partial<CurrentCrmState> = {}): CurrentCrmState => ({
  facts: [],
  evidenceKeys: new Set<string>(),
  definitions: [],
  lifecycleStage: "engaged",
  ...over
});

const classify = (proposal: AiCrmProposal, current: Partial<CurrentCrmState> = {}) =>
  classifyProposal(proposal, state(current), NOW);

describe("what a proposal can express", () => {
  it("has nowhere to put a column, a table or a query", () => {
    // Structural rather than a promise in a prompt: the type carries facts under
    // keys, evidence under fixed components, values for declared fields and a
    // stage from the vocabulary, and nothing else.
    const proposal: AiCrmProposal = {
      facts: [
        {
          key: "budget",
          value: "5k",
          confidence: "inferred",
          sourceRef: "msg-2",
          recordedAt: NOW.toISOString()
        }
      ]
    };
    expect(Object.keys(proposal)).toEqual(["facts"]);
    expect(Object.keys(proposal.facts![0]!)).not.toContain("column");
  });

  it("exports nothing that could execute a write on its own", () => {
    for (const [name, exported] of Object.entries(aiWrite)) {
      if (typeof exported !== "function") continue;
      expect(name).toMatch(/^(classifyProposal|summariseProposal|evidenceKey)$/);
    }
  });
});

describe("classifying a remembered fact", () => {
  const fact = (over: Partial<StoredFact> = {}) => ({
    key: "budget",
    value: "about 8k",
    confidence: "inferred" as const,
    sourceRef: "msg-2",
    recordedAt: NOW.toISOString(),
    ...over
  });

  it("calls the customer's own words confirmed and a reading of them inferred", () => {
    expect(classify({ facts: [fact({ confidence: "confirmed" })] }).facts[0]).toMatchObject({
      verdict: "confirmed",
      commit: true
    });
    expect(classify({ facts: [fact()] }).facts[0]).toMatchObject({
      verdict: "inferred",
      commit: true
    });
  });

  it("calls a write the memory policy refused on strength a conflict, not a rejection", () => {
    // The distinction is what an operator reviews: a conflicted write means the
    // model disagreed with something known, which is worth a person's time.
    const result = classify({ facts: [fact()] }, { facts: [stored()] });
    expect(result.facts[0]).toMatchObject({ verdict: "conflicted", commit: false });
  });

  it("refuses a fact with no provenance outright", () => {
    const result = classify({ facts: [fact({ sourceRef: "" })] });
    expect(result.facts[0]).toMatchObject({ verdict: "rejected", commit: false });
  });

  it("does not let a batch launder a weak write in behind a strong one", () => {
    const result = classify({
      facts: [fact({ confidence: "human_verified", value: "9k" }), fact({ value: "1k" })]
    });
    expect(result.facts.map((item) => item.commit)).toEqual([true, false]);
  });
});

describe("classifying evidence", () => {
  const evidence = (over: Partial<aiWrite.ProposedEvidence> = {}): aiWrite.ProposedEvidence => ({
    signal: "asked for pricing",
    component: "intent",
    weight: 20,
    confidence: "inferred",
    evidenceRef: "event-1",
    ...over
  });

  it("accepts a new observation with a reference", () => {
    expect(classify({ evidence: [evidence()] }).evidence[0]).toMatchObject({
      verdict: "inferred",
      commit: true
    });
  });

  it("refuses a component outside the contract", () => {
    const result = classify({
      evidence: [evidence({ component: "vibes" as aiWrite.ProposedEvidence["component"] })]
    });
    expect(result.evidence[0]).toMatchObject({ verdict: "rejected", commit: false });
  });

  it("refuses evidence that cannot say where it came from", () => {
    expect(classify({ evidence: [evidence({ evidenceRef: "  " })] }).evidence[0]).toMatchObject({
      verdict: "rejected",
      commit: false
    });
  });

  it("refuses the same observation twice", () => {
    // A re-processed conversation would otherwise raise the score once per
    // replay for one thing that happened.
    const result = classify(
      { evidence: [evidence()] },
      { evidenceKeys: new Set([evidenceKey("intent", "event-1")]) }
    );
    expect(result.evidence[0]).toMatchObject({ verdict: "rejected", reason: "already recorded" });
  });

  it("refuses a duplicate inside one proposal too", () => {
    const result = classify({ evidence: [evidence(), evidence()] });
    expect(result.evidence.map((item) => item.commit)).toEqual([true, false]);
  });
});

describe("classifying a custom field value", () => {
  const definitions = [
    { fieldKey: "industry", fieldType: "text" as const, aiWrite: "inferred" as const },
    { fieldKey: "seats", fieldType: "number" as const, aiWrite: "suggest" as const },
    { fieldKey: "vat_id", fieldType: "text" as const, aiWrite: "never" as const }
  ];

  const value = (over: Partial<aiWrite.ProposedFieldValue> = {}): aiWrite.ProposedFieldValue => ({
    fieldKey: "industry",
    value: "logistics",
    sourceRef: "msg-3",
    ...over
  });

  it("writes into a field the workspace opened to the model", () => {
    const result = classify({ fieldValues: [value()] }, { definitions });
    expect(result.fieldValues[0]).toMatchObject({ verdict: "inferred", commit: true });
  });

  it("refuses a field nobody defined", () => {
    // The difference between a custom field and an arbitrary column.
    const result = classify(
      { fieldValues: [value({ fieldKey: "internal_notes" })] },
      { definitions }
    );
    expect(result.fieldValues[0]).toMatchObject({ verdict: "rejected", reason: "no such field" });
  });

  it("refuses a field the workspace closed to the model", () => {
    const result = classify({ fieldValues: [value({ fieldKey: "vat_id" })] }, { definitions });
    expect(result.fieldValues[0]).toMatchObject({ verdict: "rejected", commit: false });
  });

  it("keeps a suggestion as an inference nobody committed", () => {
    // The fifth state the four names cannot express: a real, well-formed value
    // that a person still has to accept.
    const result = classify(
      { fieldValues: [value({ fieldKey: "seats", value: 12 })] },
      { definitions }
    );
    expect(result.fieldValues[0]).toMatchObject({ verdict: "inferred", commit: false });
  });

  it("refuses a value of the wrong type", () => {
    const result = classify(
      { fieldValues: [value({ fieldKey: "seats", value: "a dozen" })] },
      { definitions }
    );
    expect(result.fieldValues[0]).toMatchObject({ verdict: "rejected", commit: false });
  });
});

describe("classifying a stage change", () => {
  it("refuses a stage nobody defined", () => {
    const result = classify({
      transition: { to: "almost" as never, reasonCodes: ["budget_confirmed"] }
    });
    expect(result.transition).toMatchObject({ verdict: "rejected", reason: "no such stage" });
  });

  it("refuses a move to where the contact already is", () => {
    const result = classify({ transition: { to: "engaged", reasonCodes: ["x"] } });
    expect(result.transition).toMatchObject({ verdict: "rejected", reason: "already there" });
  });

  it("refuses a change that does not say why", () => {
    const result = classify({ transition: { to: "qualified", reasonCodes: [] } });
    expect(result.transition?.commit).toBe(false);
  });

  it("passes a well-formed one on for the real decision", () => {
    // Whether the move is allowed is `authorizeLifecycleTransition`'s call, and
    // it is the same call a person's move goes through.
    const result = classify({ transition: { to: "qualified", reasonCodes: ["budget_confirmed"] } });
    expect(result.transition).toMatchObject({ verdict: "inferred", commit: true });
  });
});

describe("summarising for the trace", () => {
  it("counts every candidate exactly once", () => {
    const counts = summariseProposal(
      classify({
        facts: [
          {
            key: "budget",
            value: "8k",
            confidence: "confirmed",
            sourceRef: "m1",
            recordedAt: NOW.toISOString()
          }
        ],
        evidence: [
          {
            signal: "asked",
            component: "intent",
            weight: 10,
            confidence: "inferred",
            evidenceRef: "e1"
          }
        ],
        transition: { to: "qualified", reasonCodes: [] }
      })
    );
    expect(counts).toEqual({ confirmed: 1, inferred: 1, conflicted: 0, rejected: 1 });
  });
});

describe("the repository applies one", () => {
  function harness(over: Record<string, FakeRow[]> = {}) {
    const fake = createFakeSupabase({
      tables: {
        crm_radar_view: [
          {
            workspace_id: WORKSPACE,
            customer_id: CUSTOMER,
            display_name: "Probe",
            company_name: null,
            status: "active",
            source: "manual",
            lifecycle_stage: "engaged",
            lead_status: "needs_reply",
            created_at: "2026-08-01T00:00:00.000Z",
            updated_at: "2026-08-28T00:00:00.000Z",
            score: null,
            unread_inbound: 1,
            human_review_requested: false,
            followup_due_at: null,
            followup_snoozed_until: null,
            opted_out: false,
            has_evidence: false,
            owner_id: null,
            channel: "whatsapp",
            last_activity_at: "2026-08-28T00:00:00.000Z",
            current_need: null,
            current_need_confidence: null
          }
        ],
        contact_facts: [],
        qualification_evidence: [],
        custom_field_definitions: [],
        customer_custom_field_values: [],
        crm_score_configs: [],
        crm_score_snapshots: [],
        lifecycle_events: [],
        customers: [
          {
            id: CUSTOMER,
            workspace_id: WORKSPACE,
            lifecycle_stage: "engaged",
            lead_status: "needs_reply"
          }
        ],
        crm_audit_events: [],
        ...over
      },
      rpc: {
        // The snapshot RPC's own behaviour - locking, and finding the score this
        // one follows - is asserted against a real engine in the migration
        // tests. What matters here is that the write path reaches it.
        record_score_snapshot: () => ({
          data: [{ snapshot_id: "s1", previous_score: null }],
          error: null,
          count: null
        })
      }
    });
    return { fake, repository: new SupabaseCrmRepository(fake.client, workspace) };
  }

  const proposal: AiCrmProposal = {
    facts: [
      {
        key: "current_need",
        value: "A quote for 200 units",
        confidence: "confirmed",
        sourceRef: "event-1",
        recordedAt: NOW.toISOString()
      }
    ],
    evidence: [
      {
        signal: "asked for pricing",
        component: "intent",
        weight: 20,
        confidence: "inferred",
        evidenceRef: "event-1"
      }
    ]
  };

  it("commits what it accepted and leaves the rest alone", async () => {
    const { fake, repository } = harness();
    const outcome = await repository.applyAiProposal(CUSTOMER, proposal, NOW);
    expect(outcome.remembered).toBe(1);
    expect(fake.database.rows("contact_facts")).toHaveLength(1);
    expect(fake.database.rows("qualification_evidence")).toHaveLength(1);
  });

  it("recomputes the score from the evidence rather than adjusting it", async () => {
    const { fake, repository } = harness();
    const outcome = await repository.applyAiProposal(CUSTOMER, proposal, NOW);
    // The evidence this proposal just committed is what the score is built
    // from: recomputed from the rows on file, never adjusted by a delta.
    expect(outcome.score.score).toBeGreaterThan(0);
    expect(fake.database.rpcCalls.map((call) => call.name)).toContain("record_score_snapshot");
  });

  it("computes the next action and does not store it", async () => {
    // A derived action is a function of the state just written; the projection
    // refuses `derived` for that reason, and this is the caller that would
    // otherwise have written one.
    const { fake, repository } = harness();
    const outcome = await repository.applyAiProposal(CUSTOMER, proposal, NOW);
    expect(outcome.nextAction.source).toBe("derived");
    expect(fake.database.rows("crm_next_action_projection")).toHaveLength(0);
  });

  it("records what the model changed as an audited action", async () => {
    const { fake, repository } = harness();
    await repository.applyAiProposal(CUSTOMER, proposal, NOW);
    const [entry] = fake.database.rows("crm_audit_events");
    expect(entry).toMatchObject({ action: "crm.ai_write", customer_id: CUSTOMER });
  });

  it("writes nothing for a proposal it refused in full", async () => {
    const { fake, repository } = harness({
      contact_facts: [
        {
          workspace_id: WORKSPACE,
          customer_id: CUSTOMER,
          fact_key: "current_need",
          fact_value: "Something else",
          confidence: "human_verified",
          source_ref: "person-1",
          recorded_at: "2026-08-25T00:00:00.000Z",
          valid_until: null
        }
      ]
    });
    const outcome = await repository.applyAiProposal(
      CUSTOMER,
      { facts: proposal.facts ?? [] },
      NOW
    );
    expect(outcome.classified.facts[0]).toMatchObject({ verdict: "conflicted", commit: false });
    // The person's value stands, untouched.
    expect(fake.database.rows("contact_facts")[0]!.fact_value).toBe("Something else");
  });

  it("does not read or write another workspace's customer", async () => {
    const { repository } = harness({ crm_radar_view: [] });
    await expect(repository.applyAiProposal(CUSTOMER, proposal, NOW)).rejects.toThrow(
      "CUSTOMER_NOT_FOUND"
    );
  });
  it("refuses, rather than returning an empty result, when proposals are off", async () => {
    // The return type has no way to say "nothing happened": it promises a
    // classification, a score and a next action. An empty one of those would
    // read as a proposal that was considered and found to contain nothing,
    // which is a different and much quieter claim than a refusal.
    const { fake, repository } = harness({
      workspace_feature_overrides: [
        { workspace_id: WORKSPACE, flag_key: "ai_proposals", enabled: false, expires_at: null }
      ]
    });
    await expect(repository.applyAiProposal(CUSTOMER, proposal, NOW)).rejects.toThrow(
      "FEATURE_NOT_ENABLED:ai_proposals"
    );
    expect(fake.database.rows("contact_facts")).toHaveLength(0);
    expect(fake.database.rows("qualification_evidence")).toHaveLength(0);
    expect(fake.database.rows("crm_audit_events")).toHaveLength(0);
  });

  it("checks the flag before it reads anything", async () => {
    // Gating after the reads would leave a refused proposal costing the same
    // five queries as an accepted one, on the path most likely to be called in
    // a loop by a workspace that is not entitled to it.
    const { fake, repository } = harness({
      workspace_feature_overrides: [
        { workspace_id: WORKSPACE, flag_key: "ai_proposals", enabled: false, expires_at: null }
      ]
    });
    await expect(repository.applyAiProposal(CUSTOMER, proposal, NOW)).rejects.toThrow();
    expect(fake.database.rpcCalls.map((call) => call.name)).toEqual(["workspace_feature_enabled"]);
  });
});
