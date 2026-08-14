import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  computePaytrDirectApiHash,
  computePaytrNotificationHash,
  computePaytrTokenRequestHash,
  parsePaytrFormBody,
  verifyPaytrNotificationHash
} from "@/src/modules/billing/providers/paytr-signature";

describe("PayTR notification signature", () => {
  const merchantKey = "synthetic-merchant-key";
  const merchantSalt = "synthetic-merchant-salt";
  const fields = { merchant_oid: "order-123", status: "success", total_amount: "49900" };

  it("parses an application/x-www-form-urlencoded body", () => {
    const raw = new TextEncoder().encode(
      "merchant_oid=order-123&status=success&total_amount=49900"
    );
    expect(parsePaytrFormBody(raw)).toEqual(fields);
  });

  it("verifies a hash computed with the matching key and salt", () => {
    const hash = computePaytrNotificationHash(fields, merchantKey, merchantSalt);
    expect(verifyPaytrNotificationHash({ ...fields, hash }, merchantKey, merchantSalt)).toBe(true);
  });

  it("rejects a tampered field, a wrong key and a wrong salt", () => {
    const hash = computePaytrNotificationHash(fields, merchantKey, merchantSalt);
    expect(
      verifyPaytrNotificationHash({ ...fields, status: "failed", hash }, merchantKey, merchantSalt)
    ).toBe(false);
    expect(verifyPaytrNotificationHash({ ...fields, hash }, "wrong-key", merchantSalt)).toBe(false);
    expect(verifyPaytrNotificationHash({ ...fields, hash }, merchantKey, "wrong-salt")).toBe(false);
  });

  it("rejects a malformed hash without throwing", () => {
    expect(
      verifyPaytrNotificationHash({ ...fields, hash: "not-base64!!" }, merchantKey, merchantSalt)
    ).toBe(false);
  });
});

describe("PayTR get-token request signing", () => {
  const merchantKey = "synthetic-merchant-key";
  const merchantSalt = "synthetic-merchant-salt";
  const tokenFields = {
    merchant_id: "123456",
    user_ip: "203.0.113.1",
    merchant_oid: "order-123",
    email: "owner@example.test",
    payment_amount: "0",
    user_basket: "W1siQ2FyZCIsIjAuMDAiLDFdXQ==",
    no_installment: "1",
    max_installment: "0",
    currency: "TL",
    test_mode: "0"
  };

  it("matches HMAC-SHA256(fields-concatenated + salt, key), base64-encoded", () => {
    const expected = createHmac("sha256", merchantKey)
      .update(
        tokenFields.merchant_id +
          tokenFields.user_ip +
          tokenFields.merchant_oid +
          tokenFields.email +
          tokenFields.payment_amount +
          tokenFields.user_basket +
          tokenFields.no_installment +
          tokenFields.max_installment +
          tokenFields.currency +
          tokenFields.test_mode +
          merchantSalt
      )
      .digest("base64");
    expect(computePaytrTokenRequestHash(tokenFields, merchantKey, merchantSalt)).toBe(expected);
  });

  it("changes when any single field changes", () => {
    const base = computePaytrTokenRequestHash(tokenFields, merchantKey, merchantSalt);
    const changed = computePaytrTokenRequestHash(
      { ...tokenFields, merchant_oid: "order-124" },
      merchantKey,
      merchantSalt
    );
    expect(changed).not.toBe(base);
  });
});

describe("PayTR Direct API request signing", () => {
  const merchantKey = "synthetic-merchant-key";
  const merchantSalt = "synthetic-merchant-salt";
  const directFields = {
    merchant_id: "123456",
    user_ip: "203.0.113.1",
    merchant_oid: "order-456",
    email: "owner@example.test",
    payment_amount: "49900",
    payment_type: "card",
    installment_count: "0",
    currency: "TL",
    test_mode: "0",
    non_3d: "1"
  };

  it("matches HMAC-SHA256(fields-concatenated + salt, key), base64-encoded", () => {
    const expected = createHmac("sha256", merchantKey)
      .update(
        directFields.merchant_id +
          directFields.user_ip +
          directFields.merchant_oid +
          directFields.email +
          directFields.payment_amount +
          directFields.payment_type +
          directFields.installment_count +
          directFields.currency +
          directFields.test_mode +
          directFields.non_3d +
          merchantSalt
      )
      .digest("base64");
    expect(computePaytrDirectApiHash(directFields, merchantKey, merchantSalt)).toBe(expected);
  });

  it("changes when any single field changes", () => {
    const base = computePaytrDirectApiHash(directFields, merchantKey, merchantSalt);
    const changed = computePaytrDirectApiHash(
      { ...directFields, payment_amount: "1000" },
      merchantKey,
      merchantSalt
    );
    expect(changed).not.toBe(base);
  });
});
