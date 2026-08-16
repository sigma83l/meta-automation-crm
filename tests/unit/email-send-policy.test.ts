import { describe, expect, it } from "vitest";
import { CATEGORY_STREAMS, streamFor, type EmailMessage } from "@/src/modules/email/contracts";
import {
  authorizeInboundReply,
  authorizeSend,
  carriesSecretMaterial,
  isSecretVariable,
  requiresUnsubscribe,
  toLoggableSend,
  type ConsentState
} from "@/src/modules/email/send-policy";

const message = (over: Partial<EmailMessage> = {}): EmailMessage => ({
  category: "auth_recovery",
  to: "hamed@example.com",
  templateId: "recovery-v1",
  variables: { first_name: "Hamed", recovery_url: "https://app.example/r/abc123" },
  idempotencyKey: "recovery:1",
  locale: "en",
  ...over
});

const consent = (over: Partial<ConsentState> = {}): ConsentState => ({
  marketingConsent: false,
  unsubscribedAt: null,
  suppressed: false,
  ...over
});

describe("secrets never leave the email", () => {
  it("recognises the names a token actually travels under", () => {
    // The bare word rarely appears; recovery_token_url and otpCode do.
    for (const name of [
      "token",
      "recovery_token_url",
      "otpCode",
      "otp_code",
      "one_time_passcode",
      "password",
      "magic_link",
      "magicLink",
      "confirmation_url",
      "confirmationUrl",
      "verify_url",
      "recovery_url",
      "invite_link",
      "reset_url",
      "code"
    ]) {
      expect(`${name}:${isSecretVariable(name)}`).toBe(`${name}:true`);
    }
  });

  it("treats any access-granting link as a secret, token in the name or not", () => {
    // recovery_url is a password reset in one click. Calling it an ordinary
    // link because the word "token" is absent is how one ends up in a log line.
    expect(isSecretVariable("recovery_url")).toBe(true);
    expect(isSecretVariable("url_for_recovery")).toBe(true);
  });

  it("leaves ordinary variables alone", () => {
    for (const name of ["first_name", "workspace_name", "invoice_total", "plan"]) {
      expect(`${name}:${isSecretVariable(name)}`).toBe(`${name}:false`);
    }
  });

  it("flags a recovery message as carrying secret material", () => {
    expect(carriesSecretMaterial(message())).toBe(true);
  });

  it("does not flag a plain notification", () => {
    expect(
      carriesSecretMaterial(
        message({ category: "workspace_notification", variables: { workspace_name: "Acme" } })
      )
    ).toBe(false);
  });
});

describe("what may be recorded about a send", () => {
  const loggable = toLoggableSend(message());

  it("records names but never values", () => {
    // Even non-secret values: a variable called first_name holds a person's
    // name.
    const serialised = JSON.stringify(loggable);
    expect(serialised).not.toContain("abc123");
    expect(serialised).not.toContain("Hamed");
    expect(loggable.variableNames).toEqual(["first_name", "recovery_url"]);
  });

  it("records the recipient domain, not the address", () => {
    // The local part identifies a person.
    expect(loggable.recipientDomain).toBe("example.com");
    expect(JSON.stringify(loggable)).not.toContain("hamed@");
  });

  it("keeps the correlation key, which is what makes a send traceable", () => {
    expect(loggable.idempotencyKey).toBe("recovery:1");
    expect(loggable.templateId).toBe("recovery-v1");
  });

  it("builds the record rather than redacting the message", () => {
    // Redaction runs after the secret is already in the object, so anything
    // that serialises earlier has already leaked it. Nothing here can leak,
    // because the secret never enters.
    const keys = Object.keys(loggable);
    expect(keys).not.toContain("variables");
    expect(keys).not.toContain("to");
  });

  it("survives a malformed recipient without inventing a domain", () => {
    expect(toLoggableSend(message({ to: "not-an-address" })).recipientDomain).toBe("unknown");
  });
});

describe("streams are decided by category, not by the caller", () => {
  it("routes every auth and billing category as transactional", () => {
    for (const category of [
      "auth_verification",
      "auth_recovery",
      "security_alert",
      "billing_notice",
      "support_reply",
      "workspace_notification"
    ] as const) {
      expect(`${category}:${streamFor(category)}`).toBe(`${category}:transactional`);
    }
  });

  it("routes lifecycle as marketing", () => {
    expect(streamFor("lifecycle")).toBe("marketing");
  });

  it("assigns a stream to every category", () => {
    for (const [category, stream] of Object.entries(CATEGORY_STREAMS)) {
      expect(`${category}:${stream === "transactional" || stream === "marketing"}`).toBe(
        `${category}:true`
      );
    }
  });

  it("requires an unsubscribe path only on marketing", () => {
    // Without one a marketing email is unlawful in most places this will be
    // sent, and it turns an uninterested recipient into a spam complaint.
    expect(requiresUnsubscribe("lifecycle")).toBe(true);
    expect(requiresUnsubscribe("auth_recovery")).toBe(false);
  });
});

describe("consent applies to marketing and never to a password reset", () => {
  it("sends a recovery email to somebody who unsubscribed", () => {
    // Withholding one over an unsubscribe would lock them out of their account.
    expect(
      authorizeSend(message(), consent({ unsubscribedAt: "2026-01-01T00:00:00.000Z" }))
    ).toEqual({ allowed: true });
  });

  it("sends a recovery email to somebody with no marketing consent", () => {
    expect(authorizeSend(message(), consent({ marketingConsent: false }))).toEqual({
      allowed: true
    });
  });

  it("refuses a lifecycle email without consent", () => {
    expect(
      authorizeSend(message({ category: "lifecycle" }), consent({ marketingConsent: false }))
    ).toMatchObject({ allowed: false, reason: "no marketing consent" });
  });

  it("refuses a lifecycle email after an unsubscribe", () => {
    expect(
      authorizeSend(
        message({ category: "lifecycle" }),
        consent({ marketingConsent: true, unsubscribedAt: "2026-01-01T00:00:00.000Z" })
      )
    ).toMatchObject({ allowed: false, reason: "unsubscribed" });
  });

  it("sends a lifecycle email with consent and no unsubscribe", () => {
    expect(
      authorizeSend(message({ category: "lifecycle" }), consent({ marketingConsent: true }))
    ).toEqual({ allowed: true });
  });
});

describe("suppression applies to both streams", () => {
  it("stops even a recovery email to a hard-bounced address", () => {
    // The address does not work, and continuing damages sender reputation for
    // everybody else — including people waiting on a reset that then lands in
    // spam.
    expect(authorizeSend(message(), consent({ suppressed: true }))).toMatchObject({
      allowed: false,
      reason: "address suppressed after bounce or complaint"
    });
  });

  it("refuses something that is not an address at all", () => {
    expect(authorizeSend(message({ to: "hamed" }), consent())).toMatchObject({ allowed: false });
  });
});

describe("an inbound reply is not authorized by its From header", () => {
  it("accepts a matching token from a matching sender", () => {
    expect(
      authorizeInboundReply({
        correlationToken: "tok_abc",
        expectedToken: "tok_abc",
        fromAddressMatches: true
      })
    ).toEqual({ allowed: true });
  });

  it("refuses a reply with no correlation token", () => {
    // The From header is trivially forged, and a support thread is exactly
    // where somebody would try.
    expect(
      authorizeInboundReply({
        correlationToken: null,
        expectedToken: "tok_abc",
        fromAddressMatches: true
      })
    ).toMatchObject({ allowed: false, reason: "no correlation token" });
  });

  it("refuses a mismatched token even from the right address", () => {
    expect(
      authorizeInboundReply({
        correlationToken: "tok_wrong",
        expectedToken: "tok_abc",
        fromAddressMatches: true
      })
    ).toMatchObject({ allowed: false });
  });

  it("still requires the address to match, as corroboration", () => {
    expect(
      authorizeInboundReply({
        correlationToken: "tok_abc",
        expectedToken: "tok_abc",
        fromAddressMatches: false
      })
    ).toMatchObject({ allowed: false, reason: "sender does not match the ticket" });
  });
});
