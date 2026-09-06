import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeRow } from "@/tests/fixtures/fake-supabase";
import { SupabaseCrmRepository } from "@/src/modules/crm/adapters/supabase-crm-repository";
import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import type { EvidenceInput } from "@/src/modules/crm/contracts";

/**
 * The write path for what a qualification score is answerable for.
 *
 * `qualification_evidence` has been in the schema since the revenue-state
 * migration with nothing reading or writing it. These are the first writes, and
 * the properties worth pinning are the two the score engine will depend on: an
 * unsourced weight never lands, and one customer's evidence is only ever their
 * own.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

const workspace: TrustedWorkspace = {
  id: WORKSPACE,
  name: "Probe",
  userId: "55555555-5555-4555-8555-555555555555",
  role: "operator"
};

const evidence = (over: Partial<EvidenceInput> = {}): EvidenceInput => ({
  customerId: CUSTOMER,
  signal: "stated_budget",
  component: "financial_fit",
  weight: 20,
  confidence: "confirmed",
  evidenceRef: "msg-1",
  ...over
});

function harness(rows: FakeRow[] = []) {
  const fake = createFakeSupabase({ tables: { qualification_evidence: rows } });
  return { fake, repository: new SupabaseCrmRepository(fake.client, workspace) };
}

describe("recording evidence", () => {
  it("stores the signal against this workspace and customer", async () => {
    const { fake, repository } = harness();
    const stored = await repository.recordEvidence(evidence());
    expect(stored).toMatchObject({
      customerId: CUSTOMER,
      signal: "stated_budget",
      weight: 20,
      confidence: "confirmed",
      evidenceRef: "msg-1"
    });
    expect(fake.database.rows("qualification_evidence")[0]).toMatchObject({
      workspace_id: WORKSPACE,
      customer_id: CUSTOMER,
      evidence_ref: "msg-1"
    });
  });

  it("takes the workspace from the server, never from the caller", async () => {
    // The input type has no workspace field at all, which is the point: there
    // is no argument a caller could pass to reach another tenant.
    const { fake, repository } = harness();
    await repository.recordEvidence({
      ...evidence(),
      ...({ workspaceId: "someone-else" } as object)
    });
    expect(fake.database.rows("qualification_evidence")[0]).toMatchObject({
      workspace_id: WORKSPACE
    });
  });

  it("refuses a weight with no source", async () => {
    const { fake, repository } = harness();
    await expect(repository.recordEvidence(evidence({ evidenceRef: "" }))).rejects.toThrow();
    expect(fake.database.rows("qualification_evidence")).toEqual([]);
  });

  it("refuses a weight outside the range the column allows", async () => {
    const { repository } = harness();
    await expect(repository.recordEvidence(evidence({ weight: 101 }))).rejects.toThrow();
    await expect(repository.recordEvidence(evidence({ weight: -101 }))).rejects.toThrow();
  });

  it("accepts a negative weight, which is how a disqualifier is recorded", async () => {
    const { repository } = harness();
    const stored = await repository.recordEvidence(
      evidence({ signal: "out_of_service_area", weight: -100 })
    );
    expect(stored.weight).toBe(-100);
  });

  it("appends rather than replacing, so the same signal can be re-observed", async () => {
    // Evidence is never edited. A later observation of the same signal is a new
    // row, because the score has to be reconstructible at any past point.
    const { fake, repository } = harness();
    await repository.recordEvidence(evidence({ evidenceRef: "msg-1" }));
    await repository.recordEvidence(evidence({ evidenceRef: "msg-2" }));
    expect(fake.database.rows("qualification_evidence")).toHaveLength(2);
  });
});

describe("reading evidence", () => {
  const row = (over: Partial<FakeRow> = {}): FakeRow => ({
    id: "e1",
    workspace_id: WORKSPACE,
    customer_id: CUSTOMER,
    signal: "stated_budget",
    component: "financial_fit",
    weight: 20,
    confidence: "confirmed",
    evidence_ref: "msg-1",
    recorded_at: "2026-08-20T10:00:00.000Z",
    expires_at: null,
    ...over
  });

  it("returns this customer's signals", async () => {
    const { repository } = harness([row()]);
    expect(await repository.evidenceFor(CUSTOMER)).toEqual([
      {
        id: "e1",
        customerId: CUSTOMER,
        signal: "stated_budget",
        component: "financial_fit",
        weight: 20,
        confidence: "confirmed",
        evidenceRef: "msg-1",
        recordedAt: "2026-08-20T10:00:00.000Z",
        expiresAt: null
      }
    ]);
  });

  it("does not return another workspace's evidence", async () => {
    const { repository } = harness([row({ id: "e2", workspace_id: "someone-else" })]);
    expect(await repository.evidenceFor(CUSTOMER)).toEqual([]);
  });

  it("does not return another customer's evidence", async () => {
    const { repository } = harness([row({ id: "e3", customer_id: OTHER })]);
    expect(await repository.evidenceFor(CUSTOMER)).toEqual([]);
  });

  it("drops a weighted row that names no source", async () => {
    // The constraint prevents new ones; this is what protects a score from any
    // row that predates it.
    const { repository } = harness([row({ id: "e4", evidence_ref: null })]);
    expect(await repository.evidenceFor(CUSTOMER)).toEqual([]);
  });

  it("drops a row that names no component", async () => {
    // Same protection, for the rows written before the score engine gave
    // evidence somewhere to belong. Guessing a component would be inventing
    // what the observation was about.
    const { repository } = harness([row({ id: "e5", component: null })]);
    expect(await repository.evidenceFor(CUSTOMER)).toEqual([]);
  });
});
