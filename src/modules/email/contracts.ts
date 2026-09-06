import type { Result } from "@/src/lib/result";

/**
 * The transactional email seam.
 *
 * C-002 in the conflict register: the pack specifies Resend, the repository
 * sends auth mail through Supabase's built-in mailer, and that has been proven
 * to deliver. This port is what lets both be true — Resend becomes an adapter
 * rather than a rewrite, and the call sites never learn which one is in use.
 *
 * The split between streams is not cosmetic. Transactional mail must go out
 * regardless of marketing consent, because a password reset is not a marketing
 * message and withholding one over an unsubscribe would lock somebody out of
 * their own account. Marketing mail must never go out without consent. Putting
 * them behind one interface with a `kind` field would make that distinction a
 * runtime argument that somebody eventually passes wrong; here it is the type.
 */

export type EmailStream =
  /** Verification, recovery, security, billing, support. Consent-independent. */
  | "transactional"
  /** Lifecycle and marketing. Requires consent and an unsubscribe path. */
  | "marketing";

export type EmailCategory =
  | "auth_verification"
  | "auth_recovery"
  | "security_alert"
  | "billing_notice"
  | "support_reply"
  | "workspace_notification"
  | "lifecycle";

/** Which stream a category belongs to. Not a caller's choice. */
export const CATEGORY_STREAMS: Readonly<Record<EmailCategory, EmailStream>> = Object.freeze({
  auth_verification: "transactional",
  auth_recovery: "transactional",
  security_alert: "transactional",
  billing_notice: "transactional",
  support_reply: "transactional",
  workspace_notification: "transactional",
  lifecycle: "marketing"
});

export function streamFor(category: EmailCategory): EmailStream {
  return CATEGORY_STREAMS[category];
}

export type EmailMessage = Readonly<{
  category: EmailCategory;
  to: string;
  /** Template identifier. The body is rendered by the adapter, never passed in. */
  templateId: string;
  /**
   * Values substituted into the template.
   *
   * Deliberately narrow: strings and numbers only, no nested structures. A
   * template variable is a name or a date or a count, and allowing objects here
   * is how a whole customer record ends up interpolated into an email.
   */
  variables: Readonly<Record<string, string | number>>;
  /** Correlates a send with the durable event that requested it. */
  idempotencyKey: string;
  locale: string;
}>;

export type SendOutcome = Readonly<{
  status: "sent" | "queued" | "rejected";
  providerMessageRef?: string;
  failureCode?: string;
}>;

export interface EmailSender {
  readonly providerName: string;
  send(message: EmailMessage): Promise<Result<SendOutcome>>;
}

export type DeliveryEvent =
  | "queued"
  | "delivered"
  | "bounced"
  | "complained"
  | "failed"
  /** The recipient asked to stop. Terminal for marketing, never for transactional. */
  | "unsubscribed";

export const TERMINAL_DELIVERY_EVENTS: readonly DeliveryEvent[] = Object.freeze([
  "delivered",
  "bounced",
  "complained",
  "unsubscribed"
]);
