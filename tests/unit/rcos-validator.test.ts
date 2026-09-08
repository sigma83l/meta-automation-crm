import { describe, expect, it } from "vitest";
import {
  approvedTimeTokens,
  safeResolution,
  validateReply,
  type ValidationContext,
  type ValidationFailure
} from "@/src/modules/rcos/validator";

const context = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  availableRefs: ["faq-1", "price-1"],
  approvedAmounts: ["1200 TL"],
  approvedTimes: ["14:00"],
  hasAuthoritativeResult: false,
  claimsCompletion: false,
  canSend: true,
  alreadySentRefs: [],
  sendRef: "send-1",
  ...over
});

const failuresOf = (verdict: ReturnType<typeof validateReply>): readonly ValidationFailure[] =>
  verdict.allowed ? [] : verdict.failures;

describe("a well-grounded reply", () => {
  it("passes when everything it states is supported", () => {
    const verdict = validateReply(
      { text: "The treatment is 1200 TL and we can see you at 14:00.", citedRefs: ["price-1"] },
      context()
    );
    expect(verdict).toEqual({ allowed: true });
  });

  it("tolerates formatting differences in approved values", () => {
    // "1,200 tl" and "1200 TL" are the same money; blocking on punctuation
    // would produce constant false handoffs.
    const verdict = validateReply(
      { text: "That comes to 1,200 tl.", citedRefs: [] },
      context({ approvedAmounts: ["1200 TL"] })
    );
    expect(verdict).toEqual({ allowed: true });
  });
});

describe("grounding", () => {
  it("blocks a reply citing a reference retrieval never returned", () => {
    const verdict = validateReply({ text: "As per our policy.", citedRefs: ["faq-99"] }, context());
    expect(failuresOf(verdict)).toContain("ungrounded_claim");
  });
});

describe("authoritative values", () => {
  it("blocks a price nothing confirmed", () => {
    // The single most damaging thing a model can invent.
    const verdict = validateReply({ text: "It's only 300 TL today.", citedRefs: [] }, context());
    expect(failuresOf(verdict)).toContain("unverified_money");
  });

  it("lets an ordinary greeting through when its only 'time' is a pleasantry", () => {
    // "How can I help you today?" was blocked as an unverified time claim,
    // which sent essentially every polite opening line to a human. The word
    // asserts nothing about the business, and nothing in it can mislead.
    const verdict = validateReply(
      { text: "Hello! How can I help you today?", citedRefs: [] },
      context()
    );
    expect(failuresOf(verdict)).not.toContain("unverified_time");
  });

  it("still blocks the same word when it promises something", () => {
    // The reason "today" is in the pattern at all: this is a claim about the
    // business that nothing here backs.
    for (const text of [
      "Yes, we are open today.",
      "We can deliver today.",
      "Your order will arrive tomorrow.",
      "We are closed today."
    ]) {
      const verdict = validateReply({ text, citedRefs: [] }, context());
      expect(`${text} -> ${failuresOf(verdict).includes("unverified_time")}`).toBe(
        `${text} -> true`
      );
    }
  });

  it("still blocks a clock time or a named day on its own", () => {
    // These have no innocent reading in a message to a customer, so they are
    // never excused by the absence of an availability word.
    for (const text of ["See you at 09:30.", "Tuesday works.", "Come at 6pm."]) {
      const verdict = validateReply({ text, citedRefs: [] }, context());
      expect(`${text} -> ${failuresOf(verdict).includes("unverified_time")}`).toBe(
        `${text} -> true`
      );
    }
  });

  it("blocks an appointment time nothing confirmed", () => {
    const verdict = validateReply({ text: "See you tomorrow at 09:30.", citedRefs: [] }, context());
    expect(failuresOf(verdict)).toContain("unverified_time");
  });

  it("blocks a claimed completion with no authoritative result", () => {
    const verdict = validateReply(
      { text: "You're all booked.", citedRefs: [] },
      context({ claimsCompletion: true, hasAuthoritativeResult: false })
    );
    expect(failuresOf(verdict)).toContain("unclaimed_success");
  });

  it("allows a claimed completion once a system confirmed it", () => {
    const verdict = validateReply(
      { text: "You're all set.", citedRefs: [] },
      context({ claimsCompletion: true, hasAuthoritativeResult: true })
    );
    expect(verdict).toEqual({ allowed: true });
  });
});

describe("safety and conduct", () => {
  it("blocks a reply leaking contact details", () => {
    expect(
      failuresOf(validateReply({ text: "Email ada@example.com", citedRefs: [] }, context()))
    ).toContain("pii_leak");
  });

  it("blocks urgency pressure", () => {
    expect(
      failuresOf(validateReply({ text: "Act now, only 2 left!", citedRefs: [] }, context()))
    ).toContain("pressure_tactic");
  });

  it("blocks any send when policy forbids sending this turn", () => {
    // A draft cannot override a decision made upstream.
    expect(
      failuresOf(validateReply({ text: "Hello.", citedRefs: [] }, context({ canSend: false })))
    ).toContain("policy_violation");
  });

  it("blocks a send id already used", () => {
    // Last-moment idempotency, whatever retries happened upstream.
    expect(
      failuresOf(
        validateReply(
          { text: "Hello.", citedRefs: [] },
          context({ alreadySentRefs: ["send-1"], sendRef: "send-1" })
        )
      )
    ).toContain("duplicate_send");
  });
});

describe("reporting", () => {
  it("returns every failure rather than stopping at the first", () => {
    const verdict = validateReply(
      { text: "Act now! Only 99 TL, call +90 555 123 4567.", citedRefs: ["nope"] },
      context()
    );
    const failures = failuresOf(verdict);
    expect(failures).toEqual(
      expect.arrayContaining([
        "ungrounded_claim",
        "unverified_money",
        "pii_leak",
        "pressure_tactic"
      ])
    );
  });

  it("explains each block so the reason can be surfaced", () => {
    const verdict = validateReply({ text: "Only 99 TL.", citedRefs: [] }, context());
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.detail.join(" ")).toMatch(/99/);
  });
});

describe("safe resolution", () => {
  it("sends anything touching money to a human", () => {
    expect(safeResolution(["unverified_money"])).toMatchObject({ action: "handoff" });
  });

  it("sends a claimed-but-unconfirmed outcome to a human", () => {
    expect(safeResolution(["unclaimed_success"])).toMatchObject({ action: "handoff" });
  });

  it("acknowledges safely for conduct-only problems", () => {
    // Nobody needs to be woken up because a draft sounded pushy.
    expect(safeResolution(["pressure_tactic"])).toMatchObject({ action: "safe_acknowledgement" });
  });

  it("escalates when any failure warrants it, not only the first", () => {
    expect(safeResolution(["pressure_tactic", "unverified_time"])).toMatchObject({
      action: "handoff"
    });
  });

  it("never returns silence", () => {
    // A customer who receives nothing assumes they were ignored.
    for (const failure of [
      "ungrounded_claim",
      "pii_leak",
      "duplicate_send"
    ] as ValidationFailure[]) {
      expect(["handoff", "safe_acknowledgement"]).toContain(safeResolution([failure]).action);
    }
  });
});

describe("a draft with no text", () => {
  // This is the composer's output for a provider that is down, a model that is
  // unconfigured and a model that asked for a person — three of the most likely
  // things to happen in production, all arriving here as the empty string. It
  // used to satisfy every rule vacuously and be sent as a blank message.
  it("is blocked rather than sent", () => {
    const verdict = validateReply({ text: "", citedRefs: [] }, context());
    expect(failuresOf(verdict)).toContain("empty_draft");
  });

  it("is blocked when it is only whitespace", () => {
    const verdict = validateReply({ text: "  \n ", citedRefs: [] }, context());
    expect(failuresOf(verdict)).toContain("empty_draft");
  });

  it("resolves to a person, not to a safe acknowledgement", () => {
    // Nothing is known about what the customer needed, which is the condition
    // a handoff exists for. A generic acknowledgement would close the turn
    // while leaving the question unanswered.
    expect(safeResolution(["empty_draft"])).toEqual({
      action: "handoff",
      reason: "empty_draft"
    });
  });
});

describe("weekdays", () => {
  // Both directions of the same rule, and both were wrong: a claim about a
  // closed day slipped through unseen, while a correct answer about an open one
  // was blocked — and which of those happened depended on whether the model
  // wrote the singular or the plural.
  it("catches a plural weekday, so a closed day cannot slip through", () => {
    const verdict = validateReply(
      { text: "Yes, we are open on Saturdays too.", citedRefs: [] },
      context({ approvedTimes: ["Monday", "Friday"] })
    );
    expect(failuresOf(verdict)).toContain("unverified_time");
  });

  it("accepts a plural weekday that is approved", () => {
    const verdict = validateReply(
      { text: "We are open on Tuesdays.", citedRefs: [] },
      context({ approvedTimes: ["Tuesday"] })
    );
    expect(verdict).toEqual({ allowed: true });
  });

  it("accepts a singular weekday approved in the plural", () => {
    const verdict = validateReply(
      { text: "We are open on Tuesday.", citedRefs: [] },
      context({ approvedTimes: ["Tuesdays"] })
    );
    expect(verdict).toEqual({ allowed: true });
  });
});

describe("what an approved range authorises", () => {
  it("expands the days inside a weekday range", () => {
    expect(approvedTimeTokens("We are open Monday to Friday, 09:00 to 18:00.")).toEqual(
      expect.arrayContaining(["monday", "tuesday", "wednesday", "thursday", "friday"])
    );
  });

  it("does not expand a range of clock times", () => {
    // "09:00 to 18:00" authorises the boundaries, not 14:30. A reply naming an
    // interior time is stating something the business never said.
    const approved = approvedTimeTokens("Open 09:00 to 18:00.");
    expect(approved).not.toContain("14:30");
  });

  it("wraps a range that crosses the end of the week", () => {
    expect(approvedTimeTokens("Open Friday to Monday.")).toEqual(
      expect.arrayContaining(["friday", "saturday", "sunday", "monday"])
    );
  });

  it("leaves a weekend day unapproved when the range excludes it", () => {
    expect(approvedTimeTokens("Open Monday to Friday.")).not.toContain("saturday");
  });
});
