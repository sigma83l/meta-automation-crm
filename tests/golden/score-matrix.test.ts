import { describe, expect, it } from "vitest";

import matrix from "@/tests/golden/score-golden-matrix.json";
import { createFakeSupabase, type FakeRow } from "@/tests/fixtures/fake-supabase";
import { SupabaseCrmRepository } from "@/src/modules/crm/adapters/supabase-crm-repository";
import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import { authorizeLifecycleTransition } from "@/src/modules/crm/revenue-state";
import {
  computeScore,
  DEFAULT_SCORE_CONFIG,
  type ScoredEvidence
} from "@/src/modules/crm/qualification-score";

/**
 * The pack's score golden matrix, case for case.
 *
 * Seven sentences about what a qualification score must be able to answer for.
 * The through-line of all of them is that the number is never the authority: it
 * is a function of evidence that can be named, under a config version that can
 * be cited, and it decides nothing on its own.
 *
 * Asserted under the pack's own wording, and the key set is compared with the
 * matrix - so a case that loses its test fails this file instead of vanishing.
 */

const NOW = new Date("2026-09-02T12:00:00.000Z");
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const USER = "55555555-5555-4555-8555-555555555555";

const evidence = (over: Partial<ScoredEvidence> = {}): ScoredEvidence => ({
  component: "intent",
  weight: 20,
  confidence: "confirmed",
  evidenceRef: "msg-1",
  ...over
});

const workspaceAs = (role: TrustedWorkspace["role"]): TrustedWorkspace => ({
  id: WORKSPACE,
  name: "Probe",
  userId: USER,
  role
});

function repositoryFor(role: TrustedWorkspace["role"], over: Record<string, FakeRow[]> = {}) {
  const fake = createFakeSupabase({
    tables: {
      customers: [{ id: CUSTOMER, workspace_id: WORKSPACE }],
      qualification_evidence: [],
      crm_score_configs: [],
      crm_score_snapshots: [],
      ...over
    },
    rpc: {
      // The real function locks the customer and finds the score this snapshot
      // follows; both are asserted against a real engine in the migration
      // tests. Here it only has to record the row, so the override's own
      // provenance can be read back off it.
      record_score_snapshot: (args, database) => {
        database.rows("crm_score_snapshots").push({
          id: database.nextId(),
          workspace_id: args.p_workspace_id,
          customer_id: args.p_customer_id,
          score: args.p_score,
          components: args.p_components,
          config_version: args.p_config_version,
          reason_codes: args.p_reason_codes,
          override_by: args.p_override_by,
          override_reason: args.p_override_reason
        });
        return { data: [{ snapshot_id: "s1", previous_score: null }], error: null, count: null };
      }
    }
  });
  return { fake, repository: new SupabaseCrmRepository(fake.client, workspaceAs(role)) };
}

const CASES: Record<string, () => void | Promise<void>> = {
  "same evidence+config produces same score": () => {
    const rows = [
      evidence(),
      evidence({
        component: "financial_fit",
        weight: 15,
        confidence: "inferred",
        evidenceRef: "msg-2"
      }),
      evidence({ component: "commitment", weight: 10, evidenceRef: "msg-3" })
    ];
    expect(computeScore(rows, DEFAULT_SCORE_CONFIG, NOW)).toEqual(
      computeScore(rows, DEFAULT_SCORE_CONFIG, NOW)
    );

    // Order is where determinism actually breaks: rows come back from Postgres
    // in whatever order it likes, and a score that depended on it would drift
    // between two reads of an unchanged record.
    expect(computeScore([...rows].reverse(), DEFAULT_SCORE_CONFIG, NOW)).toEqual(
      computeScore(rows, DEFAULT_SCORE_CONFIG, NOW)
    );
  },

  "score contribution always has evidence ref": () => {
    const withRef = evidence({ evidenceRef: "msg-1" });
    const without = evidence({ component: "financial_fit", weight: 40, evidenceRef: "  " });
    const snapshot = computeScore([withRef, without], DEFAULT_SCORE_CONFIG, NOW);

    // A contribution nobody can trace is not a weaker contribution, it is none:
    // the unreferenced row moves nothing and appears in no reference list.
    expect(snapshot.components.financial_fit).toBe(0);
    expect(snapshot.evidenceRefs).toEqual(["msg-1"]);
    expect(snapshot.reasonCodes).toContain("evidence_discounted");
  },

  "disqualifier can reduce score without changing source facts": () => {
    const rows = [evidence({ weight: 30 })];
    const clean = computeScore(rows, DEFAULT_SCORE_CONFIG, NOW);
    const penalised = computeScore(
      [...rows, evidence({ component: "disqualifier", weight: -20, evidenceRef: "msg-4" })],
      DEFAULT_SCORE_CONFIG,
      NOW
    );

    expect(penalised.score).toBeLessThan(clean.score);
    expect(penalised.disqualifierPenalty).toBeLessThan(0);
    // The evidence that earned the points is untouched by the thing that took
    // them away: a disqualifier lowers the total, it does not retract a fact.
    expect(penalised.components).toMatchObject(clean.components);
    expect(rows[0]).toEqual(evidence({ weight: 30 }));
  },

  "config version change creates new snapshot": () => {
    const rows = [evidence()];
    const v1 = computeScore(rows, DEFAULT_SCORE_CONFIG, NOW);
    const v2 = computeScore(rows, { ...DEFAULT_SCORE_CONFIG, version: "v2" }, NOW);

    // Same evidence, different version: the score may well be identical, and
    // the snapshot still has to say which config produced it, or nothing can
    // reconstruct how the number was reached.
    expect(v1.configVersion).toBe(DEFAULT_SCORE_CONFIG.version);
    expect(v2.configVersion).toBe("v2");
    expect(v1).not.toEqual(v2);

    // A version with different weights is a different answer as well as a
    // different label, which is why re-using a version name has to be refused
    // rather than allowed to redefine every snapshot citing it. That the table
    // refuses a duplicate version, an edit and a delete is proven against a
    // real engine in tests/migrations/qualification-score-engine.test.ts; it
    // cannot be proven here, because an in-memory double has no constraints.
    const narrower = computeScore(
      rows,
      {
        ...DEFAULT_SCORE_CONFIG,
        version: "v3",
        components: { ...DEFAULT_SCORE_CONFIG.components, intent: 5 }
      },
      NOW
    );
    expect(narrower.score).toBeLessThan(v1.score);
  },

  "manual override requires role+reason+audit": async () => {
    // An operator may run the CRM; overruling the evidence is a different
    // power, and it is the owner's.
    const asOperator = repositoryFor("operator");
    await expect(
      asOperator.repository.overrideScore(CUSTOMER, 90, "Known buyer", NOW)
    ).rejects.toThrow();

    const asOwner = repositoryFor("owner");
    await expect(asOwner.repository.overrideScore(CUSTOMER, 90, "   ", NOW)).rejects.toThrow(
      "SCORE_OVERRIDE_REASON_REQUIRED"
    );

    await asOwner.repository.overrideScore(CUSTOMER, 90, "Known buyer, contract signed", NOW);
    const [snapshot] = asOwner.fake.database.rows("crm_score_snapshots");
    expect(snapshot).toMatchObject({
      score: 90,
      override_by: USER,
      override_reason: "Known buyer, contract signed"
    });
    // The override is on the record as an override, not as a score that simply
    // happens to disagree with its own evidence.
    expect(snapshot?.reason_codes).toContain("override");
  },

  "stale evidence recalculation is deterministic": () => {
    const fresh = evidence({ expiresAt: "2099-01-01T00:00:00.000Z" });
    const stale = evidence({
      component: "financial_fit",
      weight: 40,
      evidenceRef: "msg-2",
      expiresAt: "2026-08-01T00:00:00.000Z"
    });
    const rows = [fresh, stale];

    const first = computeScore(rows, DEFAULT_SCORE_CONFIG, NOW);
    expect(computeScore(rows, DEFAULT_SCORE_CONFIG, NOW)).toEqual(first);
    // The stale row is gone from the answer, not merely discounted in it.
    expect(first.components.financial_fit).toBe(0);
    expect(first.evidenceRefs).toEqual(["msg-1"]);

    // Expiry is read from `now`, which is passed in rather than taken here, so
    // the same rows replayed at the same instant give the same answer however
    // long after the fact the replay happens.
    const beforeExpiry = computeScore(
      rows,
      DEFAULT_SCORE_CONFIG,
      new Date("2026-07-01T00:00:00.000Z")
    );
    expect(beforeExpiry.components.financial_fit).toBeGreaterThan(0);
    expect(computeScore(rows, DEFAULT_SCORE_CONFIG, new Date("2026-07-01T00:00:00.000Z"))).toEqual(
      beforeExpiry
    );
  },

  "score alone never marks Customer or verified outcome": () => {
    // The type is the argument: a transition carries a from, a to, an actor and
    // reason codes, and there is nowhere in it to put a score. A perfect score
    // with nobody behind it is refused for the reason it should be - nobody
    // decided anything.
    expect(
      authorizeLifecycleTransition({
        from: "engaged",
        to: "customer",
        actor: "",
        reasonCodes: ["score_100"]
      })
    ).toEqual({ allowed: false, reason: "actor required" });

    expect(
      authorizeLifecycleTransition({
        from: "engaged",
        to: "customer",
        actor: USER,
        reasonCodes: []
      })
    ).toEqual({ allowed: false, reason: "reason codes required" });

    // With a person and a reason it is allowed - and what made it allowed is
    // the person and the reason, not the number.
    expect(
      authorizeLifecycleTransition({
        from: "engaged",
        to: "customer",
        actor: USER,
        reasonCodes: ["contract_signed"]
      })
    ).toEqual({ allowed: true });
  }
};

describe("the score golden matrix", () => {
  it("tests every case the pack declares, and no others", () => {
    expect(Object.keys(CASES).sort()).toEqual([...matrix.cases].sort());
  });

  for (const [name, assertion] of Object.entries(CASES)) {
    it(name, assertion);
  }
});
