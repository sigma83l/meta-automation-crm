import { createHmac, timingSafeEqual } from "node:crypto";
export function verifyMetaSignature(
  rawBody: Uint8Array,
  signature: string | null,
  appSecret: string
): boolean {
  if (!signature?.startsWith("sha256=") || !appSecret) return false;
  const supplied = signature.slice(7);
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(supplied, "hex"));
}
export function verifyMetaChallenge(
  input: { mode: string | null; token: string | null; challenge: string | null },
  expectedToken: string
) {
  return input.mode === "subscribe" &&
    expectedToken.length > 0 &&
    Boolean(input.challenge) &&
    input.token === expectedToken
    ? input.challenge
    : null;
}
