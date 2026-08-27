import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeRow } from "@/tests/fixtures/fake-supabase";
import { SupabaseCrmRepository } from "@/src/modules/crm/adapters/supabase-crm-repository";
import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import {
  OUTCOME_SOURCES,
  WIN_SOURCES,
  authorizeOutcome,
  type OutcomeClaim
} from "@/src/modules/crm/opportunity-outcome";

/**
 * Who may say a deal was won.
 *
 * This is the pack's hard fail - "AI fabricates booking/payment/outcome" - and
 * it is the one place in the CRM where getting it wrong invents revenue rather
 * than merely misfiling something. The rule is provenance, not confidence: a
 * model reading "great, I'll take it" has seen enthusiasm and not a payment.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const USER = "55555555-5555-4555-8555-555555555555";

const workspace: TrustedWorkspace = {
  id: WORKSPACE,
  name: "Probe",
  userId: USER,
  role: "operator"
};

const claim = (over: Partial<OutcomeClaim> = {}): OutcomeClaim => ({
  stage: "won",
  source: "human",
  evidenceRef: "payment-1",
  ...over
});

const row = (over: Partial<FakeRow> = {}): FakeRow => ({
  id: "o1",
  workspace_id: WORKSPACE,
  customer_id: CUSTOMER,
  stage: "open",
  value_band: "unknown",
  owner_id: null,
  next_action: null,
  lost_reason: null,
  outcome_source: null,
  outcome_evidence_ref: null,
  outcome_recorded_at: null,
  ...over
});

function harness(rows: FakeRow[] = []) {
  const fake = createFakeSupabase({ tables: { opportunities: rows } });
  return { fake, repository: new SupabaseCrmRepository(fake.client, workspace) };
}

describe("declaring a win", () => {
  it("lets a person declare one, with what it rests on", () => {
    expect(authorizeOutcome(claim())).toEqual({ allowed: true });
  });

  it("lets a provider result declare one", () => {
    // A payment confirmation is an authoritative result, not a reading of one.
    expect(authorizeOutcome(claim({ source: "provider" }))).toEqual({ allowed: true });
  });

  it("refuses a win declared by the model", () => {
    expect(authorizeOutcome(claim({ source: "ai" }))).toMatchObject({ allowed: false });
  });

  it("refuses a win declared by automation or by the system itself", () => {
    // Both are this software declaring its own success, which is the same
    // problem as the model doing it under a different name.
    expect(authorizeOutcome(claim({ source: "automation" }))).toMatchObject({ allowed: false });
    expect(authorizeOutcome(claim({ source: "system" }))).toMatchObject({ allowed: false });
  });

  it("permits exactly two sources, whatever the vocabulary grows to", () => {
    // Guards the rule against a later widening of OUTCOME_SOURCES silently
    // handing a new actor the authority to book revenue.
    const permitted = OUTCOME_SOURCES.filter(
      (source) => authorizeOutcome(claim({ source })).allowed
    );
    expect(permitted).toEqual([...WIN_SOURCES]);
  });

  it("refuses a win that cites nothing", () => {
    expect(authorizeOutcome(claim({ evidenceRef: null }))).toMatchObject({ allowed: false });
    expect(authorizeOutcome(claim({ evidenceRef: "   " }))).toMatchObject({ allowed: false });
  });
});

describe("declaring a loss", () => {
  it("accepts one from any source, with a reason", () => {
    for (const source of OUTCOME_SOURCES) {
      expect(
        authorizeOutcome({ stage: "lost", source, lostReason: "chose another provider" })
      ).toEqual({ allowed: true });
    }
  });

  it("refuses a loss that says nothing", () => {
    // A pipeline of unexplained losses teaches nothing.
    expect(authorizeOutcome({ stage: "lost", source: "human" })).toMatchObject({
      allowed: false
    });
  });
});

describe("reopening", () => {
  it("needs no evidence to move back to open", () => {
    // Requiring evidence to un-declare something would trap the mistake.
    expect(authorizeOutcome({ stage: "open", source: "human" })).toEqual({ allowed: true });
    expect(authorizeOutcome({ stage: "proposed", source: "ai" })).toEqual({ allowed: true });
  });
});

describe("the repository applies the rule", () => {
  it("opens an opportunity unsettled, whatever the caller passes", async () => {
    // There is no stage argument: one that could be created already won would
    // route around every check settleOpportunity performs.
    const { repository } = harness();
    const opened = await repository.openOpportunity({
      customerId: CUSTOMER,
      ...({ stage: "won" } as object)
    });
    expect(opened).toMatchObject({ stage: "open", outcomeSource: null });
  });

  it("records a permitted win with its provenance", async () => {
    const { repository } = harness([row()]);
    const result = await repository.settleOpportunity("o1", {
      stage: "won",
      source: "human",
      evidenceRef: "payment-1"
    });
    expect(result).toMatchObject({ outcome: "recorded" });
    if (result.outcome !== "recorded") throw new Error("expected a recorded outcome");
    expect(result.opportunity).toMatchObject({
      stage: "won",
      outcomeSource: "human",
      outcomeEvidenceRef: "payment-1"
    });
    expect(result.opportunity.outcomeRecordedAt).not.toBeNull();
  });

  it("refuses an AI win without touching the row", async () => {
    const { fake, repository } = harness([row()]);
    const result = await repository.settleOpportunity("o1", {
      stage: "won",
      source: "ai",
      evidenceRef: "msg-1"
    });
    expect(result).toMatchObject({ outcome: "refused" });
    expect(fake.database.rows("opportunities")[0]).toMatchObject({ stage: "open" });
  });

  it("clears the provenance when an opportunity is reopened", async () => {
    // A stale claim attached to a stage that no longer makes it is worse than
    // no claim: it reads as evidence for something nobody is asserting.
    const { repository } = harness([
      row({
        stage: "won",
        outcome_source: "human",
        outcome_evidence_ref: "payment-1",
        outcome_recorded_at: "2026-08-20T10:00:00.000Z"
      })
    ]);
    const result = await repository.settleOpportunity("o1", { stage: "open", source: "human" });
    if (result.outcome !== "recorded") throw new Error("expected a recorded outcome");
    expect(result.opportunity).toMatchObject({
      stage: "open",
      outcomeSource: null,
      outcomeEvidenceRef: null,
      outcomeRecordedAt: null
    });
  });

  it("will not settle an opportunity in another workspace", async () => {
    const { repository } = harness([row({ workspace_id: "elsewhere" })]);
    await expect(
      repository.settleOpportunity("o1", {
        stage: "won",
        source: "human",
        evidenceRef: "payment-1"
      })
    ).rejects.toThrow("OPPORTUNITY_NOT_FOUND");
  });

  it("does not return another customer's opportunities", async () => {
    const { repository } = harness([row({ customer_id: "another" })]);
    expect(await repository.opportunitiesFor(CUSTOMER)).toEqual([]);
  });
});
