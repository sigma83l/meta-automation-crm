import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeRow } from "@/tests/fixtures/fake-supabase";
import { SupabaseCrmRepository } from "@/src/modules/crm/adapters/supabase-crm-repository";
import type { TrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import {
  DEFAULT_SCORE_CONFIG,
  SCORE_COMPONENTS,
  computeScore,
  counts,
  validateScoreConfig,
  type ScoreConfig,
  type ScoredEvidence
} from "@/src/modules/crm/qualification-score";

/**
 * A score that can be argued with.
 *
 * The seven cases in `tests/02_SCORE_GOLDEN_MATRIX.json` are the spine of this
 * file, and each one is really a claim about what the number is allowed to be:
 * reproducible, sourced, reducible by disqualifiers without editing facts,
 * re-snapshotted on a config change, overridable only on the record,
 * deterministic across expiry, and never on its own a reason to call somebody a
 * customer.
 */

const NOW = new Date("2026-08-28T12:00:00.000Z");
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const USER = "55555555-5555-4555-8555-555555555555";

const workspace: TrustedWorkspace = {
  id: WORKSPACE,
  name: "Probe",
  userId: USER,
  role: "admin"
};

const ev = (over: Partial<ScoredEvidence> = {}): ScoredEvidence => ({
  component: "intent",
  weight: 25,
  confidence: "confirmed",
  evidenceRef: "msg-1",
  ...over
});

function harness(
  rows: FakeRow[] = [],
  configs: FakeRow[] = [],
  role: "admin" | "operator" = "admin"
) {
  const fake = createFakeSupabase({
    tables: {
      qualification_evidence: rows,
      crm_score_configs: configs,
      crm_score_snapshots: []
    },
    rpc: {
      // The RPC's own behaviour - locking, and finding the score this one
      // follows - is asserted against a real engine in the migration tests.
      record_score_snapshot: () => ({
        data: [{ snapshot_id: "s1", previous_score: null }],
        error: null,
        count: null
      })
    }
  });
  return { fake, repository: new SupabaseCrmRepository(fake.client, { ...workspace, role }) };
}

const evidenceRow = (over: Partial<FakeRow> = {}): FakeRow => ({
  id: "e1",
  workspace_id: WORKSPACE,
  customer_id: CUSTOMER,
  signal: "stated_budget",
  component: "intent",
  weight: 25,
  confidence: "confirmed",
  evidence_ref: "msg-1",
  recorded_at: "2026-08-20T10:00:00.000Z",
  expires_at: null,
  ...over
});

describe("same evidence and config produce the same score", () => {
  it("gives the same answer twice", () => {
    const evidence = [ev(), ev({ component: "fit", weight: 20 })];
    expect(computeScore(evidence, DEFAULT_SCORE_CONFIG, NOW)).toEqual(
      computeScore(evidence, DEFAULT_SCORE_CONFIG, NOW)
    );
  });

  it("does not depend on the order the evidence arrives in", () => {
    // Integer contributions are why: float addition is not associative, so a
    // score summed in a different row order could differ in the last place.
    const evidence = [
      ev({ weight: 7, confidence: "inferred" }),
      ev({ component: "fit", weight: 13, confidence: "high_confidence" }),
      ev({ component: "urgency", weight: 9, confidence: "inferred" })
    ];
    const forwards = computeScore(evidence, DEFAULT_SCORE_CONFIG, NOW);
    const backwards = computeScore([...evidence].reverse(), DEFAULT_SCORE_CONFIG, NOW);
    expect(forwards).toEqual(backwards);
  });

  it("discounts by confidence rather than treating every claim alike", () => {
    const confirmed = computeScore([ev({ weight: 20 })], DEFAULT_SCORE_CONFIG, NOW);
    const inferred = computeScore(
      [ev({ weight: 20, confidence: "inferred" })],
      DEFAULT_SCORE_CONFIG,
      NOW
    );
    expect(confirmed.score).toBe(20);
    expect(inferred.score).toBe(8);
  });

  it("scores an unevidenced contact zero, not a neutral middle", () => {
    // "We know nothing" and "we assessed them as average" are different claims
    // and only one of them is true.
    const empty = computeScore([], DEFAULT_SCORE_CONFIG, NOW);
    expect(empty.score).toBe(0);
    expect(empty.confidence).toBe(0);
    expect(empty.reasonCodes).toContain("no_evidence");
  });

  it("reaches exactly 100 when every component is fully evidenced", () => {
    // The caps total 100, which is why the contract's normalisation needs no
    // scaling factor.
    const full = SCORE_COMPONENTS.map((component) =>
      ev({ component, weight: DEFAULT_SCORE_CONFIG.components[component] })
    );
    expect(computeScore(full, DEFAULT_SCORE_CONFIG, NOW).score).toBe(100);
  });

  it("caps a component at its weight however much evidence piles up", () => {
    const piled = [ev({ weight: 25 }), ev({ weight: 25, evidenceRef: "msg-2" })];
    expect(computeScore(piled, DEFAULT_SCORE_CONFIG, NOW).components.intent).toBe(25);
  });
});

describe("every contribution names its evidence", () => {
  it("ignores evidence with no reference", () => {
    expect(computeScore([ev({ evidenceRef: null })], DEFAULT_SCORE_CONFIG, NOW).score).toBe(0);
  });

  it("ignores a reference that is only whitespace", () => {
    expect(computeScore([ev({ evidenceRef: "   " })], DEFAULT_SCORE_CONFIG, NOW).score).toBe(0);
  });

  it("reports every reference that did contribute, deduplicated", () => {
    const snapshot = computeScore(
      [ev(), ev({ component: "fit", weight: 10 }), ev({ component: "urgency", weight: 5 })],
      DEFAULT_SCORE_CONFIG,
      NOW
    );
    expect(snapshot.evidenceRefs).toEqual(["msg-1"]);
  });

  it("says when something was discounted", () => {
    const snapshot = computeScore([ev(), ev({ evidenceRef: null })], DEFAULT_SCORE_CONFIG, NOW);
    expect(snapshot.reasonCodes).toContain("evidence_discounted");
  });
});

describe("a disqualifier reduces a score without changing a source fact", () => {
  it("subtracts from the total", () => {
    const base = [ev({ weight: 25 }), ev({ component: "fit", weight: 20 })];
    const withPenalty = [...base, ev({ component: "disqualifier", weight: -30 })];
    expect(computeScore(base, DEFAULT_SCORE_CONFIG, NOW).score).toBe(45);
    expect(computeScore(withPenalty, DEFAULT_SCORE_CONFIG, NOW).score).toBe(15);
  });

  it("leaves the component scores exactly as the evidence found them", () => {
    // This is what "without changing source facts" means: intent is still 25,
    // and the penalty is visible beside it rather than folded into it.
    const snapshot = computeScore(
      [ev({ weight: 25 }), ev({ component: "disqualifier", weight: -30 })],
      DEFAULT_SCORE_CONFIG,
      NOW
    );
    expect(snapshot.components.intent).toBe(25);
    expect(snapshot.disqualifierPenalty).toBe(-30);
    expect(snapshot.reasonCodes).toContain("disqualified");
  });

  it("floors the total at zero rather than going negative", () => {
    const snapshot = computeScore(
      [ev({ weight: 10 }), ev({ component: "disqualifier", weight: -100 })],
      DEFAULT_SCORE_CONFIG,
      NOW
    );
    expect(snapshot.score).toBe(0);
  });

  it("never lets a disqualifier raise a score, whatever sign it was recorded with", () => {
    const snapshot = computeScore(
      [ev({ weight: 20 }), ev({ component: "disqualifier", weight: 40 })],
      DEFAULT_SCORE_CONFIG,
      NOW
    );
    expect(snapshot.disqualifierPenalty).toBe(0);
    expect(snapshot.score).toBe(20);
  });

  it("respects the configured floor", () => {
    const capped: ScoreConfig = { ...DEFAULT_SCORE_CONFIG, disqualifierMin: -10 };
    const snapshot = computeScore(
      [ev({ weight: 25 }), ev({ component: "disqualifier", weight: -80 })],
      capped,
      NOW
    );
    expect(snapshot.disqualifierPenalty).toBe(-10);
    expect(snapshot.score).toBe(15);
  });

  it("keeps a negative signal inside its own component from going negative", () => {
    // "Not a great fit" reduces fit to nothing. Pulling the whole total down is
    // what a disqualifier is for, and conflating the two would silently promote
    // a reservation into a rejection.
    const snapshot = computeScore(
      [ev({ weight: 25 }), ev({ component: "fit", weight: -50 })],
      DEFAULT_SCORE_CONFIG,
      NOW
    );
    expect(snapshot.components.fit).toBe(0);
    expect(snapshot.score).toBe(25);
  });
});

describe("stale evidence recalculation is deterministic", () => {
  const expiring = ev({ weight: 25, expiresAt: "2026-08-27T00:00:00.000Z" });

  it("counts evidence that has not expired", () => {
    expect(counts(ev({ expiresAt: "2026-09-01T00:00:00.000Z" }), NOW)).toBe(true);
  });

  it("drops evidence that has", () => {
    expect(counts(expiring, NOW)).toBe(false);
    expect(computeScore([expiring], DEFAULT_SCORE_CONFIG, NOW).score).toBe(0);
  });

  it("gives the same answer at the same instant, before and after expiry", () => {
    const before = new Date("2026-08-26T00:00:00.000Z");
    expect(computeScore([expiring], DEFAULT_SCORE_CONFIG, before)).toEqual(
      computeScore([expiring], DEFAULT_SCORE_CONFIG, before)
    );
    expect(computeScore([expiring], DEFAULT_SCORE_CONFIG, NOW)).toEqual(
      computeScore([expiring], DEFAULT_SCORE_CONFIG, NOW)
    );
    expect(computeScore([expiring], DEFAULT_SCORE_CONFIG, before).score).toBe(25);
  });

  it("treats an unparseable expiry as expired", () => {
    // The alternative is letting a malformed date grant a fact permanent life,
    // which is the wrong way to fail.
    expect(counts(ev({ expiresAt: "sometime next year" }), NOW)).toBe(false);
  });
});

describe("what the score says about itself", () => {
  it("names its strongest drivers, biggest first", () => {
    const snapshot = computeScore(
      [
        ev({ weight: 25 }),
        ev({ component: "fit", weight: 20 }),
        ev({ component: "engagement", weight: 5 })
      ],
      DEFAULT_SCORE_CONFIG,
      NOW
    );
    expect(snapshot.topDrivers.map((driver) => driver.component)).toEqual([
      "intent",
      "fit",
      "engagement"
    ]);
  });

  it("names what an unevidenced contact is missing, most costly first", () => {
    const snapshot = computeScore([], DEFAULT_SCORE_CONFIG, NOW);
    expect(snapshot.topBlockers).toEqual([
      { component: "intent", reason: "unevidenced", cost: 25 },
      { component: "fit", reason: "unevidenced", cost: 20 },
      { component: "need_pain", reason: "unevidenced", cost: 15 }
    ]);
  });

  it("puts a disqualifier ahead of a merely missing answer when it costs more", () => {
    const snapshot = computeScore(
      [ev({ component: "disqualifier", weight: -40 })],
      DEFAULT_SCORE_CONFIG,
      NOW
    );
    expect(snapshot.topBlockers[0]).toEqual({
      component: "disqualifier",
      reason: "disqualified",
      cost: 40
    });
  });

  it("reports confidence as how strong the evidence was, not how high the score is", () => {
    const inferred = computeScore(
      [ev({ weight: 20, confidence: "inferred" })],
      DEFAULT_SCORE_CONFIG,
      NOW
    );
    const confirmed = computeScore([ev({ weight: 20 })], DEFAULT_SCORE_CONFIG, NOW);
    expect(inferred.confidence).toBe(0.4);
    expect(confirmed.confidence).toBe(1);
  });

  it("weights confidence by how much each piece of evidence moved the score", () => {
    // A large confirmed signal beside a tiny guess should not read as half
    // guesswork.
    const snapshot = computeScore(
      [ev({ weight: 90 }), ev({ component: "fit", weight: 10, confidence: "inferred" })],
      DEFAULT_SCORE_CONFIG,
      NOW
    );
    expect(snapshot.confidence).toBe(0.94);
  });

  it("carries the config version it was computed against", () => {
    expect(computeScore([ev()], DEFAULT_SCORE_CONFIG, NOW).configVersion).toBe("crm-score-v1");
  });
});

describe("a config is bounded and versioned", () => {
  it("accepts the pack's V1 defaults", () => {
    expect(validateScoreConfig(DEFAULT_SCORE_CONFIG)).toEqual({ valid: true });
  });

  it("accepts a workspace's own weights that still total 100", () => {
    const custom: ScoreConfig = {
      ...DEFAULT_SCORE_CONFIG,
      version: "acme-v1",
      components: { ...DEFAULT_SCORE_CONFIG.components, intent: 30, fit: 15 }
    };
    expect(validateScoreConfig(custom)).toEqual({ valid: true });
  });

  it("refuses weights that do not total 100", () => {
    // If they total less nobody can reach 100 and the number stops meaning what
    // it says; if more, the clamp does the normalising and two workspaces stop
    // being comparable.
    const short: ScoreConfig = {
      ...DEFAULT_SCORE_CONFIG,
      components: { ...DEFAULT_SCORE_CONFIG.components, intent: 10 }
    };
    expect(validateScoreConfig(short)).toMatchObject({ valid: false });
  });

  it("refuses a version nobody named", () => {
    expect(validateScoreConfig({ ...DEFAULT_SCORE_CONFIG, version: "  " })).toMatchObject({
      valid: false
    });
  });

  it("refuses a positive disqualifier floor", () => {
    expect(validateScoreConfig({ ...DEFAULT_SCORE_CONFIG, disqualifierMin: 20 })).toMatchObject({
      valid: false
    });
  });

  it("refuses a fractional cap", () => {
    expect(
      validateScoreConfig({
        ...DEFAULT_SCORE_CONFIG,
        components: { ...DEFAULT_SCORE_CONFIG.components, intent: 24.5, fit: 20.5 }
      })
    ).toMatchObject({ valid: false });
  });
});

describe("a config version change produces a different snapshot", () => {
  it("scores the same evidence differently under different weights", () => {
    const evidence = [ev({ weight: 25 }), ev({ component: "engagement", weight: 25 })];
    const reweighted: ScoreConfig = {
      version: "acme-v2",
      components: { ...DEFAULT_SCORE_CONFIG.components, intent: 5, engagement: 25 },
      disqualifierMin: -100
    };
    const first = computeScore(evidence, DEFAULT_SCORE_CONFIG, NOW);
    const second = computeScore(evidence, reweighted, NOW);
    expect(first.score).toBe(30);
    expect(second.score).toBe(30);
    // Same total, different composition, and the version says which is which.
    expect(first.components.intent).toBe(25);
    expect(second.components.intent).toBe(5);
    expect(second.configVersion).toBe("acme-v2");
  });
});

describe("the repository boundary", () => {
  it("falls back to the pack's defaults when a workspace has no config", async () => {
    const { repository } = harness();
    expect(await repository.activeScoreConfig()).toEqual(DEFAULT_SCORE_CONFIG);
  });

  it("stores a valid config", async () => {
    const { repository } = harness();
    const result = await repository.saveScoreConfig({
      version: "acme-v1",
      components: DEFAULT_SCORE_CONFIG.components
    });
    expect(result).toMatchObject({ outcome: "stored" });
  });

  it("refuses weights that do not total 100 rather than throwing", async () => {
    // An operator mistake with a correction, not a fault.
    const { fake, repository } = harness();
    const result = await repository.saveScoreConfig({
      version: "acme-v1",
      components: { ...DEFAULT_SCORE_CONFIG.components, intent: 90 }
    });
    expect(result).toMatchObject({ outcome: "refused" });
    expect(fake.database.rows("crm_score_configs")).toHaveLength(0);
  });

  it("scores from stored evidence and records a snapshot", async () => {
    const { repository } = harness([evidenceRow()]);
    const snapshot = await repository.rescoreCustomer(CUSTOMER, NOW);
    expect(snapshot.score).toBe(25);
    expect(snapshot.evidenceRefs).toEqual(["msg-1"]);
    expect(snapshot.configVersion).toBe("crm-score-v1");
  });

  it("ignores another customer's evidence", async () => {
    const { repository } = harness([evidenceRow({ id: "e9", customer_id: "someone-else" })]);
    expect((await repository.rescoreCustomer(CUSTOMER, NOW)).score).toBe(0);
  });

  it("ignores evidence that predates the component column", async () => {
    const { repository } = harness([evidenceRow({ component: null })]);
    expect((await repository.rescoreCustomer(CUSTOMER, NOW)).score).toBe(0);
  });
});

describe("an override is a person overruling the evidence, on the record", () => {
  it("records who, why, and what the evidence had said", async () => {
    const { repository } = harness([evidenceRow()]);
    const snapshot = await repository.overrideScore(CUSTOMER, 90, "met them in person", NOW);
    expect(snapshot.score).toBe(90);
    expect(snapshot.overrideBy).toBe(USER);
    expect(snapshot.overrideReason).toBe("met them in person");
    // The components stay as the evidence computed them, so the gap between
    // what was supported and what was decided stays visible.
    expect(snapshot.components.intent).toBe(25);
    expect(snapshot.reasonCodes).toContain("override");
  });

  it("refuses an operator", async () => {
    const { repository } = harness([evidenceRow()], [], "operator");
    await expect(repository.overrideScore(CUSTOMER, 90, "trust me", NOW)).rejects.toThrow();
  });

  it("refuses an override with no reason", async () => {
    const { repository } = harness([evidenceRow()]);
    await expect(repository.overrideScore(CUSTOMER, 90, "   ", NOW)).rejects.toThrow();
  });

  it("refuses a score outside 0..100", async () => {
    const { repository } = harness([evidenceRow()]);
    await expect(repository.overrideScore(CUSTOMER, 120, "keen", NOW)).rejects.toThrow();
  });
});

describe("a score is not a lifecycle stage", () => {
  it("exposes nothing that turns a number into a stage", () => {
    // The seventh golden case, and the one a type system can actually hold: a
    // perfect score produces a snapshot and nothing that names a stage or an
    // outcome. Whether somebody is a Customer is decided by
    // authorizeLifecycleTransition, against evidence and an actor.
    const full = SCORE_COMPONENTS.map((component) =>
      ev({ component, weight: DEFAULT_SCORE_CONFIG.components[component] })
    );
    const snapshot = computeScore(full, DEFAULT_SCORE_CONFIG, NOW);
    expect(snapshot.score).toBe(100);
    expect(Object.keys(snapshot)).not.toContain("lifecycleStage");
    expect(Object.keys(snapshot)).not.toContain("stage");
    expect(JSON.stringify(snapshot)).not.toContain("customer");
  });
});
