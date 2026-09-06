import { randomBytes } from "node:crypto";
import { appError, err, ok } from "@/src/lib/result";
import { authorizeLiveBillingAction } from "@/src/modules/billing/live-billing-gate";
import type {
  ChargeOutcome,
  PaymentProvider,
  VerifiedBillingWebhookEvent
} from "@/src/modules/billing/contracts";
import type { BillingActionAuthorization } from "@/src/modules/billing/live-billing-gate";

type InitInput = Readonly<{
  workspaceId: string;
  returnUrl: string;
  customerRef: string;
  customerEmail: string;
  userIp: string;
  authorization: BillingActionAuthorization;
}>;
type VerifyCallbackInput = Readonly<{
  rawBody: Uint8Array;
  query: Readonly<Record<string, string>>;
}>;
type ChargeInput = Readonly<{
  providerCustomerRef: string;
  providerCardRef: string;
  amountMinorUnits: number;
  customerEmail: string;
  userIp: string;
  currency: "TRY";
  orderRef: string;
  authorization: BillingActionAuthorization;
}>;
type VerifyWebhookInput = Readonly<{
  rawBody: Uint8Array;
  headers: Readonly<Record<string, string>>;
}>;

/**
 * Deterministic sandbox adapter for dev/test. The fixture "card number" is
 * carried through the query string of the (locally simulated) redirect
 * round trip: the same fixture value always yields the same
 * providerCardRef/fingerprint, so tests can simulate "the same physical
 * card reused across workspaces" by reusing the same fixtureCard value.
 * Reserved values: "0000" simulates a declined registration,
 * a providerCardRef ending in "0000" simulates a declined charge, and one
 * ending in "9999" simulates an ambiguous/unknown charge outcome.
 */
export function createFakePaymentProvider(): PaymentProvider {
  return Object.freeze({
    providerName: "fake" as const,
    // The fake "redirect" is built and consumed inside this process and never
    // reaches a real browser-controlled provider page, so the callback is a
    // closed loop. The live-billing gate keeps this provider out of live mode.
    callbackAuthority: "authoritative" as const,

    async initCardRegistration(input: InitInput) {
      const authorization = authorizeLiveBillingAction(input.authorization);
      if (!authorization.ok) return authorization;

      const providerSessionRef = `fake-session-${randomBytes(8).toString("hex")}`;
      const separator = input.returnUrl.includes("?") ? "&" : "?";
      const redirectUrl = `${input.returnUrl}${separator}fixtureCard=4111&providerSessionRef=${providerSessionRef}`;
      return ok({ redirectUrl, providerSessionRef });
    },

    async verifyCardRegistrationCallback(input: VerifyCallbackInput) {
      const fixtureCard = input.query.fixtureCard ?? "4111";
      if (fixtureCard === "0000") {
        return err(
          appError("BILLING_CARD_REGISTRATION_FAILED", "The synthetic test card was declined.")
        );
      }
      const suffix = fixtureCard.slice(-4).padStart(4, "0");
      return ok({
        providerCustomerRef: `fake-customer-${fixtureCard}`,
        providerCardRef: `fake-card-${fixtureCard}`,
        cardBrand: "SyntheticCard",
        maskedCardSuffix: suffix,
        cardFingerprintSource: `fake-card-${fixtureCard}`
      });
    },

    async chargeStoredCard(input: ChargeInput) {
      const authorization = authorizeLiveBillingAction(input.authorization);
      if (!authorization.ok) return authorization;

      if (input.providerCardRef.endsWith("0000")) {
        const outcome: ChargeOutcome = { status: "declined", failureCode: "synthetic_decline" };
        return ok(outcome);
      }
      if (input.providerCardRef.endsWith("9999")) {
        const outcome: ChargeOutcome = { status: "unknown" };
        return ok(outcome);
      }
      const outcome: ChargeOutcome = {
        status: "succeeded",
        providerTransactionRef: `fake-txn-${input.orderRef}`
      };
      return ok(outcome);
    },

    verifyAndParseWebhook(input: VerifyWebhookInput) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(input.rawBody));
      } catch {
        return err(
          appError("VALIDATION_ERROR", "Synthetic billing webhook payload is not valid JSON.")
        );
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof (parsed as Record<string, unknown>).merchantOid !== "string" ||
        typeof (parsed as Record<string, unknown>).status !== "string"
      ) {
        return err(
          appError(
            "VALIDATION_ERROR",
            "Synthetic billing webhook payload is missing required fields."
          )
        );
      }
      const record = parsed as { merchantOid: string; status: string };
      const event: VerifiedBillingWebhookEvent = {
        eventRef: `fake-event-${record.merchantOid}-${record.status}`,
        eventType: record.status === "success" ? "charge.succeeded" : "charge.failed",
        chargeAttemptId: record.merchantOid,
        safePayload: { status: record.status }
      };
      return ok(event);
    }
  });
}
