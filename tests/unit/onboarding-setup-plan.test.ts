import { describe, expect, it } from "vitest";

import { approvedTimeTokens, validateReply } from "@/src/modules/rcos/validator";
import {
  DEFAULT_AI_MODE,
  businessHoursFrom,
  cannotAnswerCustomers,
  defaultsFor,
  handoverLevels,
  hoursKey,
  openingHoursFaq,
  readStage,
  setupStages,
  validateStage,
  weekdays
} from "@/src/modules/workspaces/onboarding/setup-plan";

const noOtherFailures = {
  availableRefs: [],
  approvedAmounts: [],
  hasAuthoritativeResult: true,
  claimsCompletion: false,
  canSend: true,
  alreadySentRefs: [],
  sendRef: "send-1"
};

describe("onboarding setup plan", () => {
  it("defaults every stage to values a workspace can actually run on", () => {
    for (const stage of setupStages) {
      expect(validateStage(stage, defaultsFor(stage, "tr", "Europe/Istanbul"))).toEqual({});
    }
    // The defect this exists for: pressing Continue without touching anything
    // used to store a mode with no provider, so every turn ended in a handoff.
    expect(readStage(defaultsFor("assistant", "tr", "Europe/Istanbul")).mode).toBe(DEFAULT_AI_MODE);
    expect(cannotAnswerCustomers(DEFAULT_AI_MODE)).toBe(false);
    expect(readStage(defaultsFor("limits", "tr", "Europe/Istanbul")).handover).toBe(
      handoverLevels.balanced
    );
    expect(
      readStage(defaultsFor("limits", "tr", "Europe/Istanbul")).escalationKeywords.length
    ).toBeGreaterThan(0);
  });

  it("stores every day's hours as a value that names its own day", () => {
    const hours = businessHoursFrom(defaultsFor("hours", "en", "Europe/Istanbul"));
    expect(hours.monday).toBe("Monday 09:00 to 18:00");
    // The trap: `loadTurnContext` reads Object.values(), so a value of "closed"
    // approves the word "closed" and never the day it belongs to.
    expect(hours.saturday).toBe("Saturday closed");
    for (const day of weekdays) expect(hours[day]).toContain(day[0]!.toUpperCase() + day.slice(1));
  });

  it("lets a reply state the days and times the workspace approved", () => {
    const approved = Object.values(
      businessHoursFrom(defaultsFor("hours", "en", "Europe/Istanbul"))
    ).flatMap((entry) => [entry, ...approvedTimeTokens(entry)]);

    expect(
      validateReply(
        { text: "We open at 09:00 on Monday and we are closed on Saturday.", citedRefs: [] },
        { ...noOtherFailures, approvedTimes: approved }
      )
    ).toEqual({ allowed: true });

    // A day nobody described stays unapproved, which is the behaviour the
    // allowlist exists for.
    const withoutSaturday = approved.filter((entry) => !entry.toLowerCase().includes("saturday"));
    const verdict = validateReply(
      { text: "We are closed on Saturday.", citedRefs: [] },
      { ...noOtherFailures, approvedTimes: withoutSaturday }
    );
    expect(verdict.allowed).toBe(false);
  });

  it("turns the hours into an approved answer in the workspace's own language", () => {
    const draft = defaultsFor("hours", "tr", "Europe/Istanbul");
    const turkish = openingHoursFaq(draft, "tr");
    expect(turkish.question).toBe("Çalışma saatleriniz nedir?");
    expect(turkish.answer).toContain("Pazartesi: 09:00 - 18:00");
    expect(turkish.answer).toContain("Cumartesi: kapalı");
    // A language the product has no copy for falls back rather than shipping
    // half a sentence.
    expect(openingHoursFaq(draft, "de").question).toBe("What are your opening hours?");
    // Whatever language the answer is in, the times in it are the ones the
    // hours approved, so quoting it verbatim is not an unverified time.
    const approved = Object.values(businessHoursFrom(draft)).flatMap((entry) => [
      entry,
      ...approvedTimeTokens(entry)
    ]);
    expect(
      validateReply(
        { text: "09:00 - 18:00", citedRefs: [] },
        { ...noOtherFailures, approvedTimes: approved }
      )
    ).toEqual({ allowed: true });
  });

  it("refuses the answers that reached production", () => {
    const knowledge = validateStage("knowledge", {
      faqQuestion: "jhj",
      faqAnswer: "w",
      priceName: "x",
      priceAmount: "0",
      currency: "ZZZ"
    });
    expect(knowledge.faqQuestion).toBe("tooShort");
    expect(knowledge.faqAnswer).toBe("tooShort");
    expect(knowledge.priceName).toBe("tooShort");
    expect(knowledge.priceAmount).toBe("notAnAmount");
    expect(knowledge.currency).toBe("notAChoice");

    expect(
      validateStage("limits", { escalationKeywords: ["uy"], forbiddenClaims: ["wef"] })
    ).toMatchObject({
      escalationKeywords: "tooShort",
      forbiddenClaims: "tooShort"
    });
    expect(validateStage("welcome", { replyLanguage: "jgwejf" }).replyLanguage).toBe("notAChoice");
    expect(validateStage("hours", { timezone: "Mars/Olympus" }).timezone).toBe("notATimezone");
    expect(
      validateStage("hours", {
        timezone: "Europe/Istanbul",
        ...Object.fromEntries(weekdays.map((day) => [hoursKey(day), "closed"]))
      }).days
    ).toBe("noOpenDay");
  });

  it("asks a question to be written as a question", () => {
    const draft = {
      faqQuestion: "Do you deliver to the city centre",
      faqAnswer: "Yes, we deliver to the city centre every weekday."
    };
    expect(validateStage("knowledge", draft).faqQuestion).toBe("notAQuestion");
    expect(readStage(draft).faq).toBeUndefined();
    expect(readStage({ ...draft, faqQuestion: `${draft.faqQuestion}?` }).faq).toEqual({
      question: "Do you deliver to the city centre?",
      answer: draft.faqAnswer
    });
  });

  it("omits what it cannot use rather than substituting a value nobody chose", () => {
    // Autosave sends half-typed stages on every blur; anything unusable has to
    // leave the stored value alone instead of overwriting it.
    const partial = readStage({ priceName: "Haircut", priceAmount: "", currency: "TRY" });
    expect(partial.price).toBeUndefined();
    expect(partial.mode).toBeUndefined();
    expect(readStage({ priceName: "Haircut", priceAmount: "450", currency: "TRY" }).price).toEqual({
      name: "Haircut",
      amountMinor: 45_000,
      currency: "TRY"
    });
  });
});
