import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeRow } from "@/tests/fixtures/fake-supabase";
import { buildSystemPrompt, buildUserPrompt } from "@/src/modules/ai/prompt";
import { buildReplyInput, createAiTurnPorts } from "@/src/modules/rcos/ai-turn-ports";
import { loadTurnContext, type ProfileRow } from "@/src/modules/rcos/turn-runtime";
import { validateReply } from "@/src/modules/rcos/validator";
import type { TurnEvent } from "@/src/modules/rcos/turn-engine";

/**
 * What one turn is allowed to know about the business it answers for.
 *
 * The gap this covers: `business_profiles` has carried a brand name, a
 * description, a tone, an answer length, an emoji policy, a timezone and
 * opening hours since it was created, and none of them reached a model. Every
 * workspace got one voiceless assistant, and the commonest question a business
 * is asked - when are you open - could only be answered by a workspace that
 * had also written an FAQ repeating its own hours.
 */

const WORKSPACE = "99999999-9999-4999-8999-999999999999";
const CONVERSATION = "88888888-8888-4888-8888-888888888888";
const CUSTOMER = "77777777-7777-4777-8777-777777777777";

const event: TurnEvent = {
  eventId: "evt-1",
  workspaceId: WORKSPACE,
  conversationId: CONVERSATION,
  channel: "whatsapp",
  text: "what time do you open?",
  occurredAt: "2026-09-09T10:00:00.000Z"
};

const profile = (over: Partial<ProfileRow> = {}): ProfileRow => ({
  brand_name: "Meridian Dental",
  description: "A two-surgery dental practice.",
  tone: "formal",
  answer_length: "medium",
  emoji_policy: "off",
  timezone: "Europe/Istanbul",
  primary_language: "tr",
  fallback_language: "en",
  forbidden_claims: ["that a treatment is painless"],
  escalation_keywords: ["refund"],
  low_confidence_threshold: 0.65,
  business_hours: {
    monday: "09:00-18:00",
    tuesday: "09:00-18:00",
    saturday: "closed"
  },
  ai_mode: "PLATFORM_PAID_DEFAULT",
  demo_mode_enabled: false,
  ...over
});

const tables = (): Record<string, FakeRow[]> => ({
  business_faq_items: [],
  business_price_items: [],
  messages: [],
  contact_facts: [],
  turn_records: []
});

async function contextFor(over: Partial<ProfileRow> = {}) {
  const fake = createFakeSupabase({ tables: tables() });
  return loadTurnContext(fake.client, event, profile(over), CUSTOMER);
}

/**
 * The approved set as the engine actually assembles it.
 *
 * Not `context.approvedTimes`. The retrieve port expands each entry through
 * `approvedTimeTokens`, so "09:00-18:00" becomes its two boundaries as well as
 * itself, and a test that read the profile value straight would be asserting
 * against a set the validator is never given. No model is involved in
 * retrieval, so this needs no provider.
 */
async function approvedTimesFor(over: Partial<ProfileRow> = {}) {
  const context = await contextFor(over);
  const ports = createAiTurnPorts({
    providers: {},
    models: {},
    loadContext: async () => context
  });
  const retrieved = await ports.retrieve(event, { intents: [], locale: "en" });
  return retrieved.approvedTimes;
}

const validateAgainst = (text: string, approvedTimes: readonly string[]) =>
  validateReply(
    { text, citedRefs: [] },
    {
      availableRefs: [],
      approvedAmounts: [],
      approvedTimes,
      hasAuthoritativeResult: false,
      claimsCompletion: false,
      canSend: true,
      alreadySentRefs: [],
      sendRef: "conv:evt"
    }
  );

describe("the workspace's own voice reaches the prompt", () => {
  it("carries what onboarding collected", async () => {
    const context = await contextFor();
    expect(context.business.brandName).toBe("Meridian Dental");
    expect(context.business.tone).toBe("formal");
    expect(context.business.answerLength).toBe("medium");
    expect(context.business.emojiPolicy).toBe("off");
    expect(context.business.timezone).toBe("Europe/Istanbul");
  });

  it("keeps the day beside the hours it belongs to", async () => {
    // `Object.values` threw the day away, which left the model with
    // "09:00-18:00" and no way to answer "are you open on Saturday?".
    const context = await contextFor();
    expect(context.business.hours).toEqual([
      { day: "monday", value: "09:00-18:00" },
      { day: "tuesday", value: "09:00-18:00" },
      { day: "saturday", value: "closed" }
    ]);
  });

  it("puts the customer's message in the prompt, or there is nothing to answer", async () => {
    // The failure this guards against was silent and total. A synthetic Test
    // Center run has a conversation id matching no row, so `messages` came back
    // empty -- and the prompt's instruction is "answer the last Customer line",
    // of which there were none. Asked "what time do you open?" against a
    // workspace whose approved FAQ answered exactly that, the model returned
    // "Hello! How can I help you today?", because the question never reached
    // it. The reply looked like a grounding failure and was an empty
    // transcript.
    const context = await contextFor();
    const withTranscript = {
      ...context,
      messages: [
        { role: "customer" as const, content: "are you open saturday?" },
        { role: "business" as const, content: "We are closed on Saturday." },
        { role: "customer" as const, content: "what time do you open?" }
      ]
    };

    const user = buildUserPrompt(buildReplyInput(event, withTranscript));

    expect(user).toContain("what time do you open?");
    // The prior exchange travels too, which is what makes a second message a
    // conversation rather than another first contact.
    expect(user).toContain("are you open saturday?");
    expect(user).toContain("We are closed on Saturday.");
    // And the message to answer is last, because that is what the instruction
    // points at.
    expect(user.lastIndexOf("what time do you open?")).toBeGreaterThan(
      user.lastIndexOf("are you open saturday?")
    );
  });

  it("names the business, its voice and its hours in the prompt", async () => {
    const context = await contextFor();
    const input = buildReplyInput(event, context);
    const system = buildSystemPrompt(input);
    const user = buildUserPrompt(input);

    expect(system).toContain("Meridian Dental");
    expect(system).toContain("A two-surgery dental practice.");
    expect(system).toContain("formal voice");
    expect(system).toContain("Use no emoji at all.");
    expect(system).toContain("Europe/Istanbul");
    expect(user).toContain("BUSINESS HOURS");
    expect(user).toContain("- monday: 09:00-18:00");
  });

  it("tells the model which message it is answering", async () => {
    // The reported failure: asked a question one approved FAQ answered, the
    // model replied "Hello! How can I help you today?". It was never told
    // which message it was answering, nor that finding the item that answers
    // it comes first.
    const context = await contextFor();
    const system = buildSystemPrompt(buildReplyInput(event, context));
    expect(system).toContain("the last Customer line");
    expect(system).toMatch(/greeting .* is not an answer/i);
  });

  it("spends no prompt on sections the workspace left empty", async () => {
    // On the smallest turn there is, this prompt is most of what the model
    // reads, so a paragraph describing an empty section is budget spent to say
    // nothing.
    const context = await contextFor({ business_hours: {} });
    const input = buildReplyInput(event, context);
    expect(buildUserPrompt(input)).not.toContain("BUSINESS HOURS");
    expect(buildSystemPrompt(input)).not.toContain("Europe/Istanbul");
  });
});

describe("what the hours approve is what the validator will accept", () => {
  it("approves a day only where that day states hours", async () => {
    // "monday: 09:00-18:00" is the workspace saying it opens on Monday, so a
    // reply saying Monday is quoting it. "saturday: closed" states no time, so
    // Saturday stays unapproved.
    const context = await contextFor();
    expect(context.approvedTimes).toContain("monday");
    expect(context.approvedTimes).toContain("tuesday");
    expect(context.approvedTimes).not.toContain("saturday");
  });

  it("reads a value that names its own day the same way", async () => {
    // Onboarding is moving to self-describing values - "Saturday closed"
    // rather than "closed" - and this side must not care which shape it gets.
    // The trap is that a weekday name counts as a time token, so a check built
    // on `timeTokens` would read "Saturday closed" as a day that states hours
    // and approve Saturday for a business that is shut.
    const context = await contextFor({
      business_hours: {
        monday: "Monday 09:00-18:00",
        saturday: "Saturday closed"
      }
    });
    expect(context.approvedTimes).toContain("monday");
    expect(context.approvedTimes).not.toContain("saturday");
  });

  it("approves nothing at all for a day that states no hours", async () => {
    // A workspace can type anything into this field. An entry with no clock
    // time approves nothing - not even itself, because the literal contains no
    // time token to approve and passing it on only gives `retrieve` a string
    // to expand a weekday out of.
    const context = await contextFor({ business_hours: { sunday: "by appointment" } });
    expect(context.approvedTimes).toEqual([]);
  });

  it("lets a reply quote the hours it was shown", async () => {
    // The whole point of showing the model the hours: the answer it writes
    // from them has to survive the validator, or the workspace is no better
    // off than when the hours were invisible.
    const approved = await approvedTimesFor();
    expect(validateAgainst("We are open Monday and Tuesday, 09:00-18:00.", approved).allowed).toBe(
      true
    );
  });

  it("still refuses a claim about a day the business is closed", async () => {
    // The bias stays where it was: a false block costs one handoff, a false
    // pass tells a customer to turn up to a locked door.
    const verdict = validateAgainst("Yes, we are open on Saturday.", await approvedTimesFor());
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.failures).toContain("unverified_time");
  });

  it("refuses a closed day just the same when the value names its own day", async () => {
    // The shape onboarding is moving to. A check built on `timeTokens` would
    // have approved Saturday here, and this reply would have been sent.
    const approved = await approvedTimesFor({
      business_hours: { monday: "Monday 09:00-18:00", saturday: "Saturday closed" }
    });
    expect(validateAgainst("Yes, we are open on Saturday.", approved).allowed).toBe(false);
    expect(validateAgainst("We are open Monday, 09:00-18:00.", approved).allowed).toBe(true);
  });
});
