import { describe, expect, it } from "vitest";

import matrix from "@/tests/golden/memory-golden-matrix.json";
import { buildSystemPrompt, buildUserPrompt } from "@/src/modules/ai/prompt";
import type { AiReplyInput } from "@/src/modules/ai/contracts";
import { classifyProposal, evidenceKey, type CurrentCrmState } from "@/src/modules/crm/ai-write";
import {
  applyMemoryWrites,
  authorizeMemoryWrite,
  currentFacts,
  type ProposedFact,
  type StoredFact
} from "@/src/modules/rcos/memory-policy";
import { TEST_BUSINESS } from "@/tests/fixtures/business-voice";

/**
 * The pack's memory golden matrix, case for case.
 *
 * Seven sentences about what customer memory must never do. They are asserted
 * here under their own words rather than paraphrased into whatever the code
 * happens to make easy, so the evidence a reviewer reads matches the claim the
 * pack makes - and a case with no test fails the file rather than quietly not
 * existing.
 *
 * These are properties of the memory rules, not of any one storage path. Where
 * a case is about what the model is told rather than what is stored, it is
 * asserted on the prompt, because that is where "does not get asked again"
 * either happens or does not.
 */

const NOW = new Date("2026-09-02T12:00:00.000Z");

const stored = (over: Partial<StoredFact> = {}): StoredFact => ({
  key: "location",
  value: "Kadıköy",
  confidence: "confirmed",
  sourceRef: "msg-1",
  recordedAt: "2026-08-01T00:00:00.000Z",
  validUntil: null,
  ...over
});

const proposed = (over: Partial<ProposedFact> = {}): ProposedFact => ({
  key: "location",
  value: "Beşiktaş",
  confidence: "inferred",
  sourceRef: "msg-9",
  recordedAt: "2026-09-01T00:00:00.000Z",
  ...over
});

const state = (over: Partial<CurrentCrmState> = {}): CurrentCrmState => ({
  facts: [],
  evidenceKeys: new Set<string>(),
  definitions: [],
  lifecycleStage: "engaged",
  ...over
});

const replyInput = (knownFacts: AiReplyInput["knownFacts"]): AiReplyInput => ({
  workspaceId: "ws-1",
  conversationId: "conv-1",
  messages: [{ role: "customer", content: "Hi again, I'd like to book." }],
  requiredFields: [],
  knownFacts,
  faqItems: [],
  priceItems: [],
  policy: {
    primaryLanguage: "tr",
    fallbackLanguage: "en",
    forbiddenClaims: [],
    escalationKeywords: [],
    lowConfidenceThreshold: 0.5
  },
  business: TEST_BUSINESS,
  classification: "webhook",
  demoMode: false
});

/**
 * One test per case, keyed by the pack's exact sentence.
 *
 * A record rather than a list of `it(...)` calls so the keys can be compared
 * with the matrix directly. Rewording a case in the pack breaks this file,
 * which is the intended failure: the evidence is only evidence while it still
 * answers the question that was asked.
 */
const CASES: Record<string, () => void> = {
  "confirmed fact is never overwritten by lower-confidence inference": () => {
    const verdict = authorizeMemoryWrite(proposed(), stored(), NOW);
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toContain("weaker than stored confirmed");

    // And the batch path agrees, which is the one that actually runs: a weak
    // write must not slip through by arriving beside a strong one.
    const applied = applyMemoryWrites(
      [proposed({ key: "budget", confidence: "confirmed" }), proposed()],
      [stored()],
      NOW
    );
    expect(applied.accepted.map((fact) => fact.key)).toEqual(["budget"]);
    expect(applied.refused).toHaveLength(1);
  },

  "returning customer does not get asked for known confirmed location": () => {
    // The failure this case exists for is not a bad write - it is a silence.
    // Memory was written and never read back, so the model saw one
    // conversation's transcript and asked a returning customer a question they
    // had already answered.
    const input = replyInput([{ key: "location", value: "Kadıköy", confidence: "confirmed" }]);
    const user = buildUserPrompt(input);
    expect(user).toContain("KNOWN ABOUT THIS CONTACT");
    expect(user).toContain("location: Kadıköy (confirmed)");
    // Above the untrusted fence: the workspace's record is not the customer's
    // words, and a fact placed inside the fence would be labelled as text the
    // model is told to distrust.
    expect(user.indexOf("KNOWN ABOUT THIS CONTACT")).toBeLessThan(
      user.indexOf("<<<UNTRUSTED_CUSTOMER_MESSAGES")
    );
    expect(buildSystemPrompt(input)).toContain("do not ask again");
  },

  "conflicting phone/email fact becomes review state rather than silent replace": () => {
    const onFile = stored({ key: "phone", value: "+90 555 111 22 33", confidence: "confirmed" });
    const classified = classifyProposal(
      { facts: [proposed({ key: "phone", value: "+90 555 999 88 77" })] },
      state({ facts: [onFile] }),
      NOW
    );
    const [fact] = classified.facts;
    // Conflicted, not rejected: a model disagreeing with something known is
    // exactly what an operator needs to see, and it is not written either way.
    expect(fact?.verdict).toBe("conflicted");
    expect(fact?.commit).toBe(false);
  },

  "expired availability/budget fact is not used as current truth": () => {
    const live = stored({ key: "location" });
    const expired = stored({
      key: "budget",
      value: "5000 TRY",
      validUntil: "2026-08-01T00:00:00.000Z"
    });
    expect(currentFacts([live, expired], NOW).map((fact) => fact.key)).toEqual(["location"]);

    // And a fresh observation supersedes it rather than losing to its stored
    // confidence, which would let a stale answer outrank a current one.
    expect(authorizeMemoryWrite(proposed({ key: "budget" }), expired, NOW)).toEqual({
      accepted: true,
      reason: "supersedes_expired"
    });
  },

  "human correction becomes authoritative": () => {
    const correction = proposed({ value: "Üsküdar", confidence: "human_verified" });
    expect(authorizeMemoryWrite(correction, stored(), NOW).accepted).toBe(true);

    // And it stands afterwards. A model that is certain is still a model: the
    // strongest confidence it can claim loses to a person's correction.
    const afterCorrection = stored({ value: "Üsküdar", confidence: "human_verified" });
    const model = proposed({ value: "Kadıköy", confidence: "confirmed" });
    expect(authorizeMemoryWrite(model, afterCorrection, NOW).accepted).toBe(false);
  },

  "AI extraction failure leaves source messages intact and CRM usable": () => {
    // A failed extraction proposes nothing. What matters is that nothing is
    // proposed and nothing is therefore removed - the stored record after a
    // failed turn is the record from before it.
    const before = [stored(), stored({ key: "budget", value: "5000 TRY" })];
    const applied = applyMemoryWrites([], before, NOW);
    expect(applied.accepted).toHaveLength(0);
    expect(applied.refused).toHaveLength(0);
    expect(currentFacts(before, NOW)).toHaveLength(2);

    // And a proposal that arrived without provenance is refused rather than
    // stored unattributed, which is the other half of "usable": every fact on
    // file can still say where it came from.
    const orphan = authorizeMemoryWrite(proposed({ sourceRef: "" }), undefined, NOW);
    expect(orphan).toEqual({ accepted: false, reason: "missing provenance" });
  },

  "duplicate message event does not duplicate fact/evidence": () => {
    const observation = {
      signal: "asked for pricing",
      component: "intent" as const,
      weight: 20,
      confidence: "inferred" as const,
      evidenceRef: "msg-9"
    };
    const already = state({ evidenceKeys: new Set([evidenceKey("intent", "msg-9")]) });
    const classified = classifyProposal({ evidence: [observation] }, already, NOW);
    expect(classified.evidence[0]).toMatchObject({
      verdict: "rejected",
      reason: "already recorded",
      commit: false
    });

    // The fact half: replaying the same message re-proposes the same value at
    // the same recorded time, which is accepted as a refresh and lands on the
    // same key rather than as a second row - `contact_facts` is unique on
    // (workspace, customer, key).
    const replay = applyMemoryWrites([proposed(), proposed()], [], NOW);
    expect(replay.accepted).toHaveLength(2);
    expect(new Set(replay.accepted.map((fact) => fact.key)).size).toBe(1);
  }
};

describe("the memory golden matrix", () => {
  it("tests every case the pack declares, and no others", () => {
    expect(Object.keys(CASES).sort()).toEqual([...matrix.cases].sort());
  });

  for (const [name, assertion] of Object.entries(CASES)) {
    it(name, assertion);
  }
});
