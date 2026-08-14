import "server-only";
import { randomUUID } from "node:crypto";
import { appError, err, ok } from "@/src/lib/result";
import type { ChargeOutcome, PaymentProvider } from "@/src/modules/billing/contracts";
import { authorizeLiveBillingAction } from "@/src/modules/billing/live-billing-gate";
import type { BillingActionAuthorization } from "@/src/modules/billing/live-billing-gate";
import {
  computePaytrDirectApiHash,
  computePaytrTokenRequestHash,
  parsePaytrFormBody,
  verifyPaytrNotificationHash
} from "./paytr-signature";

const PAYTR_TOKEN_ENDPOINT = "https://www.paytr.com/odeme/api/get-token";
const PAYTR_HOSTED_PAGE_BASE = "https://www.paytr.com/odeme/guvenli";
// Confirmed against PayTR's own public Postman collection ("Yeni Kart Ekleme" /
// "Kayıtlı Karttan Ödeme" requests both target this single Direct API endpoint).
const PAYTR_DIRECT_API_ENDPOINT = "https://www.paytr.com/odeme";

export type PaytrCredentials = Readonly<{
  merchantId: string;
  merchantKey: string;
  merchantSalt: string;
}>;

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
 * Real PayTR adapter, going live also requires PayTR's own merchant
 * approval for stored-card/recurring capability (an external gate outside
 * this repository). Endpoints, field names and both request-signing hash
 * formulas below are cross-checked against PayTR's own public Postman
 * collection (github.com/paytr/paytr-postman) and an independent
 * third-party notification-handler reference — not exercised against a
 * live PayTR merchant account from this repository. Confirm against a real
 * sandbox/test merchant account before setting LIVE_BILLING_ENABLED=true.
 */
export function createPaytrPaymentProvider(credentials: PaytrCredentials): PaymentProvider {
  return Object.freeze({
    providerName: "paytr" as const,
    // PayTR returns the user's browser to our callback URL. Nothing in that
    // redirect is authenticated: there is no hash over the query string, so a
    // signed-in Owner/Admin can simply navigate to the callback themselves with
    // any utoken/ctoken/card_last4 they like. The card and the trial it unlocks
    // must therefore come from the signature-verified server-to-server
    // notification, never from this redirect.
    callbackAuthority: "requires_provider_confirmation" as const,

    async initCardRegistration(input: InitInput) {
      const authorization = authorizeLiveBillingAction(input.authorization);
      if (!authorization.ok) return authorization;

      const orderRef = randomUUID();
      // Zero-amount, single-line synthetic basket: this call only stores a
      // card (store_card=1), it does not charge anything.
      const userBasket = Buffer.from(
        JSON.stringify([["Payment method verification", "0.00", 1]])
      ).toString("base64");
      const fields = {
        merchant_id: credentials.merchantId,
        user_ip: input.userIp,
        merchant_oid: orderRef,
        email: input.customerEmail,
        payment_amount: "0",
        user_basket: userBasket,
        no_installment: "1",
        max_installment: "0",
        currency: "TL",
        test_mode: "0"
      };
      const paytrToken = computePaytrTokenRequestHash(
        fields,
        credentials.merchantKey,
        credentials.merchantSalt
      );
      const body = new URLSearchParams({
        ...fields,
        paytr_token: paytrToken,
        store_card: "1",
        merchant_ok_url: input.returnUrl,
        merchant_fail_url: input.returnUrl
      });

      let response: Response;
      try {
        response = await fetch(PAYTR_TOKEN_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
          signal: AbortSignal.timeout(15_000)
        });
      } catch {
        return err(appError("PROVIDER_UNAVAILABLE", "PayTR card registration request failed."));
      }

      const payload = (await response.json().catch(() => null)) as {
        status?: string;
        token?: string;
        reason?: string;
      } | null;
      if (!response.ok || !payload || payload.status !== "success" || !payload.token) {
        return err(
          appError(
            "BILLING_CARD_REGISTRATION_FAILED",
            payload?.reason ?? "PayTR rejected the card registration request."
          )
        );
      }

      return ok({
        redirectUrl: `${PAYTR_HOSTED_PAGE_BASE}/${payload.token}`,
        providerSessionRef: orderRef
      });
    },

    /**
     * Always fails closed.
     *
     * This adapter declares `callbackAuthority: "requires_provider_confirmation"`,
     * so `completeCardRegistration` never calls this. It is kept — and kept
     * rejecting — so that a future caller who reaches for it cannot obtain card
     * credentials from an unauthenticated redirect. The redirect carries no
     * hash and no server-side confirmation, so its `utoken`/`ctoken`/`card_last4`
     * are attacker-chosen values, not evidence that a card was stored.
     */
    async verifyCardRegistrationCallback(input: VerifyCallbackInput) {
      const carriedTokenFields = Boolean(input.query.utoken || input.query.ctoken);
      return err(
        appError(
          "BILLING_CARD_REGISTRATION_FAILED",
          carriedTokenFields
            ? "PayTR redirect token fields are not authenticated and cannot register a card."
            : "PayTR card registration must be confirmed by a verified provider notification."
        )
      );
    },

    async chargeStoredCard(input: ChargeInput) {
      const authorization = authorizeLiveBillingAction(input.authorization);
      if (!authorization.ok) return authorization;

      const fields = {
        merchant_id: credentials.merchantId,
        user_ip: input.userIp,
        merchant_oid: input.orderRef,
        email: input.customerEmail,
        payment_amount: String(input.amountMinorUnits),
        payment_type: "card",
        installment_count: "0",
        currency: input.currency === "TRY" ? "TL" : input.currency,
        test_mode: "0",
        non_3d: "1"
      };
      const paytrToken = computePaytrDirectApiHash(
        fields,
        credentials.merchantKey,
        credentials.merchantSalt
      );
      const body = new URLSearchParams({
        ...fields,
        paytr_token: paytrToken,
        utoken: input.providerCustomerRef,
        ctoken: input.providerCardRef,
        recurring: "1"
      });

      let response: Response;
      try {
        response = await fetch(PAYTR_DIRECT_API_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
          signal: AbortSignal.timeout(20_000)
        });
      } catch {
        // Network failure mid-charge is genuinely uncertain persistence,
        // not a call failure — never blindly retried (AGENTS.md sent_unknown rule).
        const outcome: ChargeOutcome = { status: "unknown" };
        return ok(outcome);
      }

      const payload = (await response.json().catch(() => null)) as {
        status?: string;
        payment_id?: string;
        failed_reason_msg?: string;
      } | null;
      if (!payload) {
        const outcome: ChargeOutcome = { status: "unknown" };
        return ok(outcome);
      }
      if (payload.status === "success") {
        const outcome: ChargeOutcome = {
          status: "succeeded",
          ...(payload.payment_id ? { providerTransactionRef: payload.payment_id } : {})
        };
        return ok(outcome);
      }
      if (payload.status === "failed") {
        const outcome: ChargeOutcome = {
          status: "declined",
          ...(payload.failed_reason_msg ? { failureCode: payload.failed_reason_msg } : {})
        };
        return ok(outcome);
      }
      const outcome: ChargeOutcome = { status: "unknown" };
      return ok(outcome);
    },

    verifyAndParseWebhook(input: VerifyWebhookInput) {
      const fields = parsePaytrFormBody(input.rawBody);
      const merchantOid = fields.merchant_oid;
      const status = fields.status;
      const totalAmount = fields.total_amount;
      const hash = fields.hash;
      if (!merchantOid || !status || !totalAmount || !hash) {
        return err(appError("VALIDATION_ERROR", "PayTR webhook is missing required fields."));
      }
      const verified = verifyPaytrNotificationHash(
        { merchant_oid: merchantOid, status, total_amount: totalAmount, hash },
        credentials.merchantKey,
        credentials.merchantSalt
      );
      if (!verified) {
        return err(appError("VALIDATION_ERROR", "PayTR webhook signature is invalid."));
      }
      return ok({
        eventRef: `${merchantOid}:${status}`,
        eventType: status === "success" ? "charge.succeeded" : "charge.failed",
        chargeAttemptId: merchantOid,
        safePayload: { status, totalAmount }
      });
    }
  });
}
