import { createHmac, timingSafeEqual } from "node:crypto";

export function parsePaytrFormBody(rawBody: Uint8Array): Record<string, string> {
  const text = new TextDecoder().decode(rawBody);
  const fields: Record<string, string> = {};
  for (const pair of text.split("&")) {
    if (!pair) continue;
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    const key = decodeURIComponent(pair.slice(0, separator).replace(/\+/g, " "));
    const value = decodeURIComponent(pair.slice(separator + 1).replace(/\+/g, " "));
    fields[key] = value;
  }
  return fields;
}

/**
 * PayTR's get-token / iFrame API request-signing hash, used when initiating
 * card storage. Field order and formula
 * (`merchant_id+user_ip+merchant_oid+email+payment_amount+user_basket+no_installment+max_installment+currency+test_mode`,
 * then HMAC-SHA256 of that string + merchant_salt, keyed by merchant_key,
 * base64-encoded) is cross-checked against two independent third-party
 * PayTR integration references (a PHP client and PayTR's own public Postman
 * collection's pre-request script for "Yeni Kart Ekleme"), not exercised
 * against a live PayTR merchant account from this repository.
 */
export function computePaytrTokenRequestHash(
  fields: Readonly<{
    merchant_id: string;
    user_ip: string;
    merchant_oid: string;
    email: string;
    payment_amount: string;
    user_basket: string;
    no_installment: string;
    max_installment: string;
    currency: string;
    test_mode: string;
  }>,
  merchantKey: string,
  merchantSalt: string
): string {
  const value =
    fields.merchant_id +
    fields.user_ip +
    fields.merchant_oid +
    fields.email +
    fields.payment_amount +
    fields.user_basket +
    fields.no_installment +
    fields.max_installment +
    fields.currency +
    fields.test_mode;
  return createHmac("sha256", merchantKey)
    .update(value + merchantSalt)
    .digest("base64");
}

/**
 * PayTR's Direct API request-signing hash, used for `https://www.paytr.com/odeme`
 * calls (charging a stored card via utoken/ctoken). Field order and formula
 * (`merchant_id+user_ip+merchant_oid+email+payment_amount+payment_type+installment_count+currency+test_mode+non_3d`,
 * then HMAC-SHA256 of that string + merchant_salt, keyed by merchant_key,
 * base64-encoded) is taken from PayTR's own public Postman collection's
 * pre-request script for "Kayıtlı Karttan Ödeme" (payment from a registered
 * card), not exercised against a live PayTR merchant account from this
 * repository.
 */
export function computePaytrDirectApiHash(
  fields: Readonly<{
    merchant_id: string;
    user_ip: string;
    merchant_oid: string;
    email: string;
    payment_amount: string;
    payment_type: string;
    installment_count: string;
    currency: string;
    test_mode: string;
    non_3d: string;
  }>,
  merchantKey: string,
  merchantSalt: string
): string {
  const value =
    fields.merchant_id +
    fields.user_ip +
    fields.merchant_oid +
    fields.email +
    fields.payment_amount +
    fields.payment_type +
    fields.installment_count +
    fields.currency +
    fields.test_mode +
    fields.non_3d;
  return createHmac("sha256", merchantKey)
    .update(value + merchantSalt)
    .digest("base64");
}

/**
 * PayTR's merchant-notification hash. The field concatenation order below
 * ("merchant_oid + merchant_salt + status + total_amount", HMAC-SHA256 with
 * merchant_key, base64-encoded) is cross-checked against an independent
 * third-party PayTR notification-handler reference, not exercised against a
 * live PayTR merchant account from this repository.
 */
export function computePaytrNotificationHash(
  fields: Readonly<{ merchant_oid: string; status: string; total_amount: string }>,
  merchantKey: string,
  merchantSalt: string
): string {
  const value = `${fields.merchant_oid}${merchantSalt}${fields.status}${fields.total_amount}`;
  return createHmac("sha256", merchantKey).update(value).digest("base64");
}

export function verifyPaytrNotificationHash(
  fields: Readonly<{ merchant_oid: string; status: string; total_amount: string; hash: string }>,
  merchantKey: string,
  merchantSalt: string
): boolean {
  const expected = Buffer.from(
    computePaytrNotificationHash(fields, merchantKey, merchantSalt),
    "base64"
  );
  const supplied = Buffer.from(fields.hash, "base64");
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(expected, supplied);
}
