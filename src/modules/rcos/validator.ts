/**
 * The last check before anything reaches a customer.
 *
 * Everything upstream — policy, retrieval, tool authorisation — can be correct
 * and a reply can still be wrong, because the text is generated rather than
 * assembled. This is where a draft is compared against what is actually known.
 *
 * The bias is deliberate: a false block costs one handoff, a false pass sends a
 * customer a price, a time or a confirmation that nothing supports. Every check
 * therefore fails towards blocking, and the reasons are returned so the caller
 * can explain the block rather than merely report one.
 *
 * Pure by design: no I/O, so the rules are testable and identical everywhere.
 */

export const VALIDATION_FAILURES = [
  "empty_draft",
  "ungrounded_claim",
  "unverified_money",
  "unverified_time",
  "unclaimed_success",
  "pii_leak",
  "policy_violation",
  "pressure_tactic",
  "duplicate_send"
] as const;

export type ValidationFailure = (typeof VALIDATION_FAILURES)[number];

export type ReplyDraft = Readonly<{
  text: string;
  /** Ids of knowledge or fact rows the composer says it relied on. */
  citedRefs: readonly string[];
}>;

export type ValidationContext = Readonly<{
  /** Refs the retrieval step actually returned this turn. */
  availableRefs: readonly string[];
  /** Money values authoritative systems confirmed, as they should appear. */
  approvedAmounts: readonly string[];
  /** Times and dates confirmed by an authoritative system. */
  approvedTimes: readonly string[];
  /** Whether an authoritative system confirmed the action the reply describes. */
  hasAuthoritativeResult: boolean;
  /** Whether the reply asserts an action completed. */
  claimsCompletion: boolean;
  /** Whether policy permits sending at all this turn. */
  canSend: boolean;
  /** Provider message ids already sent for this turn. */
  alreadySentRefs: readonly string[];
  /** The id this send would use. */
  sendRef: string;
}>;

export type ValidationVerdict =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; failures: readonly ValidationFailure[]; detail: readonly string[] }>;

const MONEY = /(?:[$£€₺]\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:tl|try|usd|eur|gbp)\b)/gi;
// Weekdays carry an optional plural. Without it "we are open on Saturdays"
// matched nothing at all, so a claim about a day the business is closed was
// not merely unapproved - it was invisible to this check, and sent.
const TIME =
  /\b(?:\d{1,2}:\d{2}\s?(?:am|pm)?|\d{1,2}\s?(?:am|pm)|tomorrow|today|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?)\b/gi;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/;
const PHONE = /\+?\d[\d\s().-]{8,}\d/;
const PRESSURE =
  /\b(?:act now|last chance|only \d+ left|hurry|limited time|don'?t miss out|expires? today)\b/i;

const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
] as const;

function normalize(value: string): string {
  const folded = value.toLowerCase().replace(/[\s,]/g, "");
  // "Tuesdays" and "Tuesday" are the same day. Folding here rather than
  // approving both forms keeps the approved set a set of days rather than a
  // set of spellings.
  const singular = folded.replace(/s$/, "");
  return (WEEKDAYS as readonly string[]).includes(singular) ? singular : folded;
}

/**
 * The money and time tokens this validator would check in a piece of text.
 *
 * Exported so that whatever assembles the approved sets can approve a workspace's
 * own words using the same reading the validator applies to a draft. The
 * alternative - two regexes that are meant to agree - disagrees the first time
 * either is edited, and the symptom is a reply blocked for quoting an approved
 * answer verbatim.
 */
export function moneyTokens(text: string): readonly string[] {
  return text.match(MONEY) ?? [];
}

export function timeTokens(text: string): readonly string[] {
  return text.match(TIME) ?? [];
}

/**
 * The times a piece of approved text authorises a reply to state.
 *
 * Deliberately more generous than `timeTokens`, and the asymmetry is the point.
 * Reading a draft asks "what did this claim?", so it must be strict. Reading
 * approved text asks "what did the business authorise?", and a business that
 * wrote "Monday to Friday" authorised Tuesday - refusing to say so blocks the
 * most ordinary answer there is, and blocks it only when the model happens to
 * write the singular form, which makes the failure intermittent.
 *
 * Only ranges written between two weekday names expand. A range of clock times
 * does not: "09:00 to 18:00" authorises those two boundaries, not 14:30, and a
 * reply naming an interior time is stating something the business did not.
 */
export function approvedTimeTokens(text: string): readonly string[] {
  const tokens = [...timeTokens(text)];
  const lower = text.toLowerCase();
  const dayRange =
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\s*(?:-|–|—|to|through|until|till)\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/g;

  for (const match of lower.matchAll(dayRange)) {
    const from = WEEKDAYS.indexOf(match[1] as (typeof WEEKDAYS)[number]);
    const to = WEEKDAYS.indexOf(match[2] as (typeof WEEKDAYS)[number]);
    if (from === -1 || to === -1) continue;
    // Wraps across the end of the week, so "Friday to Monday" is four days
    // rather than an empty range.
    for (let step = 0; step <= (to - from + 7) % 7; step += 1) {
      tokens.push(WEEKDAYS[(from + step) % 7]!);
    }
  }
  return tokens;
}

/**
 * Whether every occurrence of a pattern in the draft appears in the approved
 * set. Comparison is normalised so "1,200 TL" and "1200 tl" are the same value
 * — otherwise formatting differences would produce false blocks.
 */
function unapprovedMatches(text: string, pattern: RegExp, approved: readonly string[]): string[] {
  const allowed = new Set(approved.map(normalize));
  const found = text.match(pattern) ?? [];
  return found.filter((match) => !allowed.has(normalize(match)));
}

export function validateReply(draft: ReplyDraft, context: ValidationContext): ValidationVerdict {
  const failures: ValidationFailure[] = [];
  const detail: string[] = [];

  // First, because every other check is about what the text says, and this one
  // is about there being any. An empty draft is what the composer produces for
  // a provider that is down, a model that is unconfigured, or a model that
  // asked for a person - so it is the single most travelled failure path there
  // is. Without this it passes every remaining rule vacuously and the engine
  // sends a blank message, which is the one outcome worse than silence: the
  // customer sees a reply, the workspace sees a delivered turn, and nobody
  // sees the failure.
  if (draft.text.trim().length === 0) {
    failures.push("empty_draft");
    detail.push("draft has no text");
  }

  // Sending at all is a policy decision made upstream; a draft cannot override it.
  if (!context.canSend) {
    failures.push("policy_violation");
    detail.push("policy does not permit sending on this turn");
  }

  // A reply may only cite what retrieval actually returned. Citing a ref that
  // was never retrieved means the reference was invented.
  const invented = draft.citedRefs.filter((ref) => !context.availableRefs.includes(ref));
  if (invented.length) {
    failures.push("ungrounded_claim");
    detail.push(`cited refs not retrieved this turn: ${invented.join(", ")}`);
  }

  const money = unapprovedMatches(draft.text, MONEY, context.approvedAmounts);
  if (money.length) {
    failures.push("unverified_money");
    detail.push(`money not confirmed by an authoritative source: ${money.join(", ")}`);
  }

  const times = unapprovedMatches(draft.text, TIME, context.approvedTimes);
  if (times.length) {
    failures.push("unverified_time");
    detail.push(`time not confirmed by an authoritative source: ${times.join(", ")}`);
  }

  // The fail-safe: absent an authoritative result, a reply must not say the
  // thing happened.
  if (context.claimsCompletion && !context.hasAuthoritativeResult) {
    failures.push("unclaimed_success");
    detail.push("reply asserts completion without an authoritative result");
  }

  if (EMAIL.test(draft.text) || PHONE.test(draft.text)) {
    failures.push("pii_leak");
    detail.push("reply contains contact details");
  }

  if (PRESSURE.test(draft.text)) {
    failures.push("pressure_tactic");
    detail.push("reply uses urgency pressure");
  }

  // Idempotency at the last possible moment: the same send id must not go out
  // twice, whatever retries happened upstream.
  if (context.alreadySentRefs.includes(context.sendRef)) {
    failures.push("duplicate_send");
    detail.push(`send ref already used: ${context.sendRef}`);
  }

  return failures.length ? { allowed: false, failures, detail } : { allowed: true };
}

/**
 * What to do when validation blocks.
 *
 * Never silence: a customer who receives nothing assumes they were ignored. A
 * blocked turn becomes either a safe acknowledgement or a human handoff, and
 * anything touching money, time or a claimed outcome goes to a human rather
 * than to a generic reply.
 */
export function safeResolution(
  failures: readonly ValidationFailure[]
): Readonly<{ action: "handoff" | "safe_acknowledgement"; reason: string }> {
  const needsHuman: readonly ValidationFailure[] = [
    // A draft that does not exist cannot be softened into a safe
    // acknowledgement: nothing is known about what the customer needed, which
    // is precisely the condition a person exists to resolve.
    "empty_draft",
    "unverified_money",
    "unverified_time",
    "unclaimed_success",
    "policy_violation"
  ];
  const escalating = failures.find((failure) => needsHuman.includes(failure));
  return escalating
    ? { action: "handoff", reason: escalating }
    : { action: "safe_acknowledgement", reason: failures[0] ?? "unknown" };
}
