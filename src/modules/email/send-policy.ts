import { streamFor, type EmailCategory, type EmailMessage } from "./contracts";

/**
 * Whether an email may be sent, and what may be recorded about it.
 *
 * Two rules from the pack are load-bearing here.
 *
 * The first: recovery tokens, OTPs and passwords must never enter logs,
 * analytics, support or AI context. A reset token in a log line is a standing
 * account takeover for anybody who can read logs — and that set is far wider
 * than the set who can read the mailbox it was sent to, which is the whole
 * point of sending it to a mailbox. Support tooling and AI context are worse
 * still, because both are places where a human or a model is invited to quote
 * what they find.
 *
 * The second: the UI never blocks waiting for the provider. A durable event is
 * written first and the send happens after. Someone whose password reset
 * appeared to fail because the mail provider was slow will simply request
 * another one, and the second request is as likely to fail as the first.
 */

/**
 * Variable names that carry a secret.
 *
 * Two things this has to survive. Names arrive in whatever convention the call
 * site used, so `otpCode` and `otp_code` must be treated alike — hence the
 * normalisation below, without which a `\botp\b` pattern silently misses every
 * camelCase spelling.
 *
 * And any URL that grants access is a secret, not merely the token inside it.
 * `recovery_url` is a password reset in one click; treating it as an ordinary
 * link because the word "token" is absent is exactly the mistake that puts one
 * in a log line.
 */
const SECRET_VARIABLE_PATTERNS: readonly RegExp[] = Object.freeze([
  /\btoken\b/,
  /\botp\b/,
  /\bpasscode\b/,
  /\bpassword\b/,
  /\bsecret\b/,
  /\bcode\b/,
  /\bnonce\b/,
  // Any link that acts on the recipient's behalf.
  /\b(magic|action|invite|confirm\w*|verif\w*|recover\w*|reset)\b.*\b(link|url)\b/,
  /\b(link|url)\b.*\b(magic|action|invite|confirm\w*|verif\w*|recover\w*|reset)\b/
]);

/**
 * Splits camelCase and separators into space-delimited lowercase words, so a
 * word-boundary pattern means the same thing whatever convention was used.
 */
function normaliseVariableName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .toLowerCase();
}

export function isSecretVariable(name: string): boolean {
  const normalised = normaliseVariableName(name);
  return SECRET_VARIABLE_PATTERNS.some((pattern) => pattern.test(normalised));
}

/**
 * What may be recorded about a send.
 *
 * An allowlist of shapes rather than a redaction pass over the payload.
 * Redaction is the wrong tool: it runs after the secret is already in the
 * object being logged, so anything that serialises earlier — an error handler,
 * a crash reporter, a debug statement added in a hurry — has already leaked it.
 * Building the loggable record separately means the secret never enters the
 * object at all.
 */
export type LoggableSend = Readonly<{
  category: EmailCategory;
  stream: string;
  templateId: string;
  idempotencyKey: string;
  locale: string;
  /** Names only. Never values, not even for non-secret variables: a variable
   * called `first_name` holds a person's name. */
  variableNames: readonly string[];
  /** Domain only. The local part identifies a person. */
  recipientDomain: string;
}>;

export function toLoggableSend(message: EmailMessage): LoggableSend {
  const atIndex = message.to.lastIndexOf("@");
  return Object.freeze({
    category: message.category,
    stream: streamFor(message.category),
    templateId: message.templateId,
    idempotencyKey: message.idempotencyKey,
    locale: message.locale,
    variableNames: Object.freeze(Object.keys(message.variables)),
    recipientDomain: atIndex > 0 ? message.to.slice(atIndex + 1) : "unknown"
  });
}

/**
 * Whether a message carries anything that must not outlive the email itself.
 *
 * Used to assert at the boundary — an event row, an analytics call, an AI
 * context assembly — rather than to decide whether to send. Sending a recovery
 * email with a token in it is the correct behaviour; recording one is not.
 */
export function carriesSecretMaterial(message: EmailMessage): boolean {
  return Object.keys(message.variables).some(isSecretVariable);
}

export type SendVerdict =
  Readonly<{ allowed: true }> | Readonly<{ allowed: false; reason: string }>;

export type ConsentState = Readonly<{
  marketingConsent: boolean;
  unsubscribedAt: string | null;
  /** Hard bounce or spam complaint. Sending on is both futile and harmful. */
  suppressed: boolean;
}>;

/**
 * Whether this message may go out to this recipient.
 *
 * The asymmetry between the streams is the substance. A marketing email needs
 * consent and stops at an unsubscribe. A transactional email ignores both,
 * because a password reset is not a marketing message and withholding one over
 * an unsubscribe would lock somebody out of their own account.
 *
 * Suppression is the exception that applies to both: a hard bounce means the
 * address does not work, and continuing to send to it damages sender reputation
 * for every other recipient — including the ones waiting on a reset that will
 * then land in spam.
 */
export function authorizeSend(message: EmailMessage, consent: ConsentState): SendVerdict {
  if (!message.to.includes("@")) {
    return { allowed: false, reason: "recipient is not an address" };
  }
  if (consent.suppressed) {
    return { allowed: false, reason: "address suppressed after bounce or complaint" };
  }
  if (streamFor(message.category) === "transactional") {
    return { allowed: true };
  }
  if (!consent.marketingConsent) {
    return { allowed: false, reason: "no marketing consent" };
  }
  if (consent.unsubscribedAt !== null) {
    return { allowed: false, reason: "unsubscribed" };
  }
  return { allowed: true };
}

/**
 * Whether a marketing message is properly formed.
 *
 * An unsubscribe path is not a courtesy — a marketing email without one is
 * unlawful in most of the places this will be sent, and it is also the thing
 * that turns an uninterested recipient into a spam complaint, which suppresses
 * the address for transactional mail too.
 */
export function requiresUnsubscribe(category: EmailCategory): boolean {
  return streamFor(category) === "marketing";
}

/**
 * Whether an inbound reply may be treated as coming from the ticket's owner.
 *
 * The pack is explicit that sender email alone is not authorization, and it is
 * right: the From header is trivially forged, and a support thread is exactly
 * where somebody would try. Correlation must come from a token or message id
 * that this system issued.
 */
export function authorizeInboundReply(
  input: Readonly<{
    correlationToken: string | null;
    expectedToken: string | null;
    fromAddressMatches: boolean;
  }>
): SendVerdict {
  if (!input.correlationToken || !input.expectedToken) {
    return { allowed: false, reason: "no correlation token" };
  }
  if (input.correlationToken !== input.expectedToken) {
    return { allowed: false, reason: "correlation token does not match" };
  }
  // Address match is corroboration, not authorization: required in addition to
  // the token, never instead of it.
  if (!input.fromAddressMatches) {
    return { allowed: false, reason: "sender does not match the ticket" };
  }
  return { allowed: true };
}
