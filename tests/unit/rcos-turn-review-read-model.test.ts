import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeRow } from "@/tests/fixtures/fake-supabase";
import {
  conversationsAwaitingReview,
  isReviewReason,
  latestTurnReview,
  REVIEW_REASONS
} from "@/src/modules/rcos/server/turn-review-read-model";
import { VALIDATION_FAILURES } from "@/src/modules/rcos/validator";
import { POLICY_BLOCKS } from "@/src/modules/rcos/supabase-turn-ports";
import { locales } from "@/src/lib/i18n/config";
import { dictionaryKeys } from "@/src/lib/i18n/dictionaries";

/**
 * The explanation an operator reads when the assistant stops.
 *
 * The flag on its own is an interruption; the reason is the work. These tests
 * are mostly about the reason surviving the trip out of the database, and about
 * the code list not silently falling behind the engine that produces it.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

const turn = (over: Partial<FakeRow> = {}): FakeRow => ({
  workspace_id: WORKSPACE,
  conversation_id: CONVERSATION,
  event_id: "evt-1",
  outcome: "handoff",
  reason_codes: ["low_confidence"],
  created_at: "2026-08-19T10:00:00.000Z",
  ...over
});

describe("the reason list", () => {
  it("covers every validation failure the validator can produce", () => {
    // If a new failure is added without a sentence here, an operator sees a
    // raw identifier at exactly the moment they need a sentence.
    for (const failure of VALIDATION_FAILURES) {
      expect(`${failure}:${isReviewReason(failure)}`).toBe(`${failure}:true`);
    }
  });

  it("covers every policy block the ports can produce", () => {
    for (const block of POLICY_BLOCKS) {
      expect(`${block}:${isReviewReason(block)}`).toBe(`${block}:true`);
    }
  });

  it("does not claim to explain a code it has no sentence for", () => {
    expect(isReviewReason("something_invented")).toBe(false);
    expect(REVIEW_REASONS).not.toContain("answer_from_knowledge");
  });

  it("has a sentence in every locale for every code it claims", () => {
    // isReviewReason returning true is a promise that a translation exists.
    // Without this the promise is kept by hand, and the failure is silent: the
    // dictionary falls back to the key, so the operator reads "review.pii_leak"
    // in the one place a plain sentence matters most.
    for (const locale of locales) {
      const keys = new Set(dictionaryKeys(locale));
      for (const reason of REVIEW_REASONS) {
        expect(`${locale}/${reason}:${keys.has(`review.${reason}`)}`).toBe(
          `${locale}/${reason}:true`
        );
      }
    }
  });
});

describe("the open conversation", () => {
  it("reports the most recent turn, not the first", async () => {
    const fake = createFakeSupabase({
      tables: {
        turn_records: [
          turn({ event_id: "old", reason_codes: ["escalation_keyword"] }),
          turn({
            event_id: "new",
            reason_codes: ["empty_draft"],
            created_at: "2026-08-19T12:00:00.000Z"
          })
        ]
      }
    });
    const review = await latestTurnReview(fake.client, WORKSPACE, CONVERSATION);
    expect(review?.reasonCodes).toEqual(["empty_draft"]);
  });

  it("reports nothing for a conversation that has never run a turn", async () => {
    const fake = createFakeSupabase({ tables: { turn_records: [] } });
    await expect(latestTurnReview(fake.client, WORKSPACE, CONVERSATION)).resolves.toBeUndefined();
  });

  it("does not read another workspace's turn", async () => {
    const fake = createFakeSupabase({
      tables: { turn_records: [turn({ workspace_id: "someone-else" })] }
    });
    await expect(latestTurnReview(fake.client, WORKSPACE, CONVERSATION)).resolves.toBeUndefined();
  });

  it("survives an unreadable turn record rather than taking the page down", async () => {
    // The operator came for the messages. Losing the explanation is a smaller
    // failure than losing the conversation.
    const fake = createFakeSupabase({ tables: {} });
    await expect(latestTurnReview(fake.client, WORKSPACE, CONVERSATION)).resolves.toBeUndefined();
  });

  it("treats a turn with no reason codes as having none", async () => {
    const fake = createFakeSupabase({
      tables: { turn_records: [turn({ reason_codes: null })] }
    });
    const review = await latestTurnReview(fake.client, WORKSPACE, CONVERSATION);
    expect(review?.reasonCodes).toEqual([]);
  });
});

describe("the conversation list", () => {
  it("marks only the conversations whose latest turn handed off", async () => {
    const fake = createFakeSupabase({
      tables: {
        turn_records: [
          turn({ conversation_id: CONVERSATION, outcome: "handoff" }),
          turn({ conversation_id: OTHER, event_id: "evt-2", outcome: "sent" })
        ]
      }
    });
    const flagged = await conversationsAwaitingReview(fake.client, WORKSPACE, [
      CONVERSATION,
      OTHER
    ]);
    expect([...flagged.keys()]).toEqual([CONVERSATION]);
  });

  it("keeps the newest handoff when a conversation has several", async () => {
    const fake = createFakeSupabase({
      tables: {
        turn_records: [
          turn({ event_id: "old", reason_codes: ["escalation_keyword"] }),
          turn({
            event_id: "new",
            reason_codes: ["empty_draft"],
            created_at: "2026-08-19T12:00:00.000Z"
          })
        ]
      }
    });
    const flagged = await conversationsAwaitingReview(fake.client, WORKSPACE, [CONVERSATION]);
    expect(flagged.get(CONVERSATION)?.reasonCodes).toEqual(["empty_draft"]);
  });

  it("asks the database for nothing when the list is empty", async () => {
    const fake = createFakeSupabase({ tables: { turn_records: [turn()] } });
    const flagged = await conversationsAwaitingReview(fake.client, WORKSPACE, []);
    expect(flagged.size).toBe(0);
  });

  it("does not mark another workspace's conversation", async () => {
    const fake = createFakeSupabase({
      tables: { turn_records: [turn({ workspace_id: "someone-else" })] }
    });
    const flagged = await conversationsAwaitingReview(fake.client, WORKSPACE, [CONVERSATION]);
    expect(flagged.size).toBe(0);
  });
});
