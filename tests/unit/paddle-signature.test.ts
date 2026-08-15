import { describe, expect, it } from "vitest";
import {
  PADDLE_SIGNATURE_MAX_AGE_MS,
  computePaddleSignature,
  parsePaddleSignatureHeader,
  verifyPaddleSignature
} from "@/src/modules/billing/providers/paddle/signature";

const SECRET = "pdl_ntfset_test_secret";
const NOW = new Date("2026-08-15T12:00:00.000Z");
const TS = String(Math.floor(NOW.getTime() / 1000));

const body = (payload: string): Uint8Array => new TextEncoder().encode(payload);

const signed = (payload: string, ts = TS, secret = SECRET): string =>
  `ts=${ts};h1=${computePaddleSignature(ts, body(payload), secret)}`;

const EVENT = '{"event_id":"evt_01","event_type":"transaction.completed"}';

describe("signature header parsing", () => {
  it("reads the two fields Paddle sends", () => {
    const parsed = parsePaddleSignatureHeader("ts=1755259200;h1=abc123def");
    expect(parsed).toEqual({ ts: "1755259200", h1: "abc123def" });
  });

  it("rejects a header with no digest", () => {
    expect(parsePaddleSignatureHeader("ts=1755259200")).toBeNull();
  });

  it("rejects a non-numeric timestamp", () => {
    expect(parsePaddleSignatureHeader("ts=yesterday;h1=abc123")).toBeNull();
  });

  it("rejects a digest that is not hex", () => {
    expect(parsePaddleSignatureHeader("ts=1755259200;h1=not-a-digest!")).toBeNull();
  });

  it("returns nothing for an absent header", () => {
    expect(parsePaddleSignatureHeader(undefined)).toBeNull();
  });
});

describe("verification accepts what Paddle actually sends", () => {
  it("verifies a correctly signed body", () => {
    expect(
      verifyPaddleSignature({
        rawBody: body(EVENT),
        signatureHeader: signed(EVENT),
        secret: SECRET,
        now: NOW
      })
    ).toEqual({ verified: true, ts: TS });
  });

  it("signs the raw bytes, not a reserialised object", () => {
    // Same JSON, different key order and whitespace. Verifying a re-serialised
    // document would compute a digest over something Paddle never sent.
    const reordered = '{"event_type":"transaction.completed",  "event_id":"evt_01"}';
    expect(
      verifyPaddleSignature({
        rawBody: body(reordered),
        signatureHeader: signed(EVENT),
        secret: SECRET,
        now: NOW
      })
    ).toMatchObject({ verified: false, failure: "signature_mismatch" });
  });
});

describe("verification fails closed", () => {
  it("refuses an unsigned request", () => {
    expect(
      verifyPaddleSignature({
        rawBody: body(EVENT),
        signatureHeader: undefined,
        secret: SECRET,
        now: NOW
      })
    ).toMatchObject({ verified: false, failure: "missing_signature" });
  });

  it("refuses a body altered after signing", () => {
    const header = signed(EVENT);
    const tampered = '{"event_id":"evt_01","event_type":"subscription.activated"}';
    expect(
      verifyPaddleSignature({
        rawBody: body(tampered),
        signatureHeader: header,
        secret: SECRET,
        now: NOW
      })
    ).toMatchObject({ verified: false, failure: "signature_mismatch" });
  });

  it("refuses a signature made with the wrong secret", () => {
    expect(
      verifyPaddleSignature({
        rawBody: body(EVENT),
        signatureHeader: signed(EVENT, TS, "pdl_ntfset_someone_elses_secret"),
        secret: SECRET,
        now: NOW
      })
    ).toMatchObject({ verified: false, failure: "signature_mismatch" });
  });

  it("refuses a digest of the wrong length without throwing", () => {
    // timingSafeEqual throws on a length mismatch; that must not surface as a
    // server fault on an attacker-supplied header.
    expect(
      verifyPaddleSignature({
        rawBody: body(EVENT),
        signatureHeader: `ts=${TS};h1=abcd`,
        secret: SECRET,
        now: NOW
      })
    ).toMatchObject({ verified: false, failure: "signature_mismatch" });
  });

  it("refuses a timestamp moved to defeat the digest", () => {
    // The timestamp is inside the signed payload, so editing it invalidates the
    // digest rather than extending the window.
    const header = signed(EVENT);
    const moved = header.replace(`ts=${TS}`, `ts=${Number(TS) + 30}`);
    expect(
      verifyPaddleSignature({
        rawBody: body(EVENT),
        signatureHeader: moved,
        secret: SECRET,
        now: NOW
      })
    ).toMatchObject({ verified: false, failure: "signature_mismatch" });
  });
});

describe("replay window", () => {
  it("rejects a signature older than the window", () => {
    const later = new Date(NOW.getTime() + PADDLE_SIGNATURE_MAX_AGE_MS + 1_000);
    expect(
      verifyPaddleSignature({
        rawBody: body(EVENT),
        signatureHeader: signed(EVENT),
        secret: SECRET,
        now: later
      })
    ).toMatchObject({ verified: false, failure: "stale_signature" });
  });

  it("rejects a signature dated into the future", () => {
    const earlier = new Date(NOW.getTime() - PADDLE_SIGNATURE_MAX_AGE_MS - 1_000);
    expect(
      verifyPaddleSignature({
        rawBody: body(EVENT),
        signatureHeader: signed(EVENT),
        secret: SECRET,
        now: earlier
      })
    ).toMatchObject({ verified: false, failure: "stale_signature" });
  });

  it("tolerates ordinary queueing delay", () => {
    // A webhook behind a cold start is late, not forged.
    const late = new Date(NOW.getTime() + 60_000);
    expect(
      verifyPaddleSignature({
        rawBody: body(EVENT),
        signatureHeader: signed(EVENT),
        secret: SECRET,
        now: late
      })
    ).toMatchObject({ verified: true });
  });
});
