import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Paddle notification signature verification.
 *
 * Paddle sends `Paddle-Signature: ts=<unix seconds>;h1=<hex digest>`, where the
 * digest is HMAC-SHA256 over the literal string `${ts}:${rawBody}` keyed by the
 * notification-destination secret.
 *
 * The raw body matters: verification runs on the exact bytes received, before
 * any parse. Re-serialising JSON reorders keys and normalises whitespace, and
 * the digest is then computed over a document Paddle never sent — which fails
 * for well-formed events and, worse, can be made to pass for forged ones if
 * anybody later "fixes" the mismatch by relaxing the check.
 *
 * No account is needed to exercise any of this: the format is fully specified,
 * and the tests sign fixtures with a local key.
 */

export type PaddleSignatureParts = Readonly<{ ts: string; h1: string }>;

/**
 * Paddle's own guidance is to reject old signatures to blunt replay. Five
 * minutes rather than their suggested five seconds: a webhook can sit in a
 * queue behind a cold start, and rejecting valid events over our own latency
 * turns a delivery delay into a billing incident. Replay beyond this window is
 * separately harmless anyway, since event ids are unique and ingestion is
 * idempotent — this is defence in depth, not the defence.
 */
export const PADDLE_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

export function parsePaddleSignatureHeader(
  header: string | undefined
): PaddleSignatureParts | null {
  if (!header) return null;
  let ts: string | undefined;
  let h1: string | undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "ts") ts = value;
    if (key === "h1") h1 = value;
  }
  if (!ts || !h1) return null;
  if (!/^\d+$/.test(ts)) return null;
  if (!/^[0-9a-f]+$/i.test(h1)) return null;
  return { ts, h1 };
}

export function computePaddleSignature(ts: string, rawBody: Uint8Array, secret: string): string {
  const payload = Buffer.concat([Buffer.from(`${ts}:`, "utf8"), Buffer.from(rawBody)]);
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export type PaddleVerificationFailure =
  "missing_signature" | "malformed_signature" | "stale_signature" | "signature_mismatch";

export type PaddleVerification =
  | Readonly<{ verified: true; ts: string }>
  | Readonly<{ verified: false; failure: PaddleVerificationFailure }>;

/**
 * Verifies a notification against the endpoint secret.
 *
 * Fails closed at every branch, and the failure reason is deliberately coarse
 * in what it reveals: a caller learns that verification failed, never how close
 * it came.
 */
export function verifyPaddleSignature(
  input: Readonly<{
    rawBody: Uint8Array;
    signatureHeader: string | undefined;
    secret: string;
    now?: Date;
    maxAgeMs?: number;
  }>
): PaddleVerification {
  if (!input.signatureHeader) return { verified: false, failure: "missing_signature" };

  const parts = parsePaddleSignatureHeader(input.signatureHeader);
  if (!parts) return { verified: false, failure: "malformed_signature" };

  const maxAgeMs = input.maxAgeMs ?? PADDLE_SIGNATURE_MAX_AGE_MS;
  const now = input.now ?? new Date();
  const signedAtMs = Number(parts.ts) * 1000;
  // Both directions: a timestamp far in the future is as much a sign of a
  // forged header as one far in the past.
  if (Math.abs(now.getTime() - signedAtMs) > maxAgeMs) {
    return { verified: false, failure: "stale_signature" };
  }

  const expected = Buffer.from(
    computePaddleSignature(parts.ts, input.rawBody, input.secret),
    "hex"
  );
  const supplied = Buffer.from(parts.h1, "hex");
  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false, and an exception here would read as a server fault.
  if (supplied.length !== expected.length) {
    return { verified: false, failure: "signature_mismatch" };
  }
  if (!timingSafeEqual(expected, supplied)) {
    return { verified: false, failure: "signature_mismatch" };
  }
  return { verified: true, ts: parts.ts };
}
