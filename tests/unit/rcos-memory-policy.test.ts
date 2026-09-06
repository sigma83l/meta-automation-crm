import { describe, expect, it } from "vitest";
import {
  applyMemoryWrites,
  authorizeMemoryWrite,
  hasExpired,
  type ProposedFact,
  type StoredFact
} from "@/src/modules/rcos/memory-policy";

const stored = (over: Partial<StoredFact> = {}): StoredFact => ({
  key: "budget",
  value: "5000",
  confidence: "confirmed",
  sourceRef: "msg-1",
  recordedAt: "2026-08-01T00:00:00.000Z",
  validUntil: null,
  ...over
});

const proposed = (over: Partial<ProposedFact> = {}): ProposedFact => ({
  key: "budget",
  value: "9000",
  confidence: "inferred",
  sourceRef: "msg-2",
  recordedAt: "2026-08-10T00:00:00.000Z",
  ...over
});

describe("provenance", () => {
  it("refuses a fact nobody can trace", () => {
    // An untraceable fact cannot be audited or corrected later.
    expect(authorizeMemoryWrite(proposed({ sourceRef: "" }), undefined)).toMatchObject({
      accepted: false,
      reason: "missing provenance"
    });
  });
});

describe("confidence ordering", () => {
  it("accepts a fact where nothing is stored", () => {
    expect(authorizeMemoryWrite(proposed(), undefined)).toMatchObject({ accepted: true });
  });

  it("refuses an inference overwriting something the customer confirmed", () => {
    // The damage this prevents: a guess replaces a stated fact, and every later
    // turn reasons from the guess.
    expect(authorizeMemoryWrite(proposed(), stored())).toMatchObject({
      accepted: false,
      reason: "weaker than stored confirmed"
    });
  });

  it("accepts a stronger observation over a weaker one", () => {
    expect(
      authorizeMemoryWrite(
        proposed({ confidence: "confirmed" }),
        stored({ confidence: "inferred" })
      )
    ).toMatchObject({ accepted: true, reason: "stronger" });
  });

  it("treats a human edit as outranking anything the model produced", () => {
    expect(
      authorizeMemoryWrite(
        proposed({ confidence: "human_verified" }),
        stored({ confidence: "confirmed" })
      )
    ).toMatchObject({ accepted: true });
    expect(
      authorizeMemoryWrite(
        proposed({ confidence: "confirmed" }),
        stored({ confidence: "human_verified" })
      )
    ).toMatchObject({ accepted: false });
  });
});

describe("equal confidence", () => {
  it("lets a newer observation refresh the value", () => {
    expect(
      authorizeMemoryWrite(
        proposed({ confidence: "confirmed", recordedAt: "2026-08-10T00:00:00.000Z" }),
        stored({ confidence: "confirmed", recordedAt: "2026-08-01T00:00:00.000Z" })
      )
    ).toMatchObject({ accepted: true, reason: "refreshed_equal" });
  });

  it("refuses an older observation from resurrecting a stale answer", () => {
    expect(
      authorizeMemoryWrite(
        proposed({ confidence: "confirmed", recordedAt: "2026-07-01T00:00:00.000Z" }),
        stored({ confidence: "confirmed", recordedAt: "2026-08-01T00:00:00.000Z" })
      )
    ).toMatchObject({ accepted: false });
  });

  it("refuses an unusable timestamp rather than guessing an order", () => {
    expect(
      authorizeMemoryWrite(
        proposed({ confidence: "confirmed", recordedAt: "not-a-date" }),
        stored({ confidence: "confirmed" })
      )
    ).toMatchObject({ accepted: false, reason: "unusable timestamp" });
  });
});

describe("freshness", () => {
  const now = new Date("2026-08-15T00:00:00.000Z");

  it("treats an expired fact as absent", () => {
    // Stale data must not outrank a fresh observation merely because it was
    // once confirmed.
    const expired = stored({ validUntil: "2026-08-10T00:00:00.000Z" });
    expect(hasExpired(expired, now)).toBe(true);
    expect(authorizeMemoryWrite(proposed(), expired, now)).toMatchObject({
      accepted: true,
      reason: "supersedes_expired"
    });
  });

  it("still protects a fact inside its validity window", () => {
    const live = stored({ validUntil: "2026-09-01T00:00:00.000Z" });
    expect(hasExpired(live, now)).toBe(false);
    expect(authorizeMemoryWrite(proposed(), live, now)).toMatchObject({ accepted: false });
  });

  it("treats an absent validity as never expiring", () => {
    expect(hasExpired(stored({ validUntil: null }), now)).toBe(false);
  });
});

describe("batch application", () => {
  it("keeps the strong write and reports the refused one", () => {
    const result = applyMemoryWrites(
      [proposed({ key: "budget" }), proposed({ key: "service", confidence: "confirmed" })],
      [stored({ key: "budget" })]
    );
    expect(result.accepted.map((fact) => fact.key)).toEqual(["service"]);
    expect(result.refused).toHaveLength(1);
    // Refusals are surfaced rather than dropped, so a model repeatedly trying
    // to overwrite confirmed facts is visible instead of silently ignored.
    expect(result.refused[0]?.reason).toMatch(/weaker/);
  });

  it("does not let a batch launder a weak write in behind a strong one", () => {
    // Both target the same key: the second must be compared against the first,
    // not against the original stored value.
    const result = applyMemoryWrites(
      [
        proposed({ key: "budget", confidence: "confirmed", value: "7000" }),
        proposed({ key: "budget", confidence: "inferred", value: "1" })
      ],
      []
    );
    expect(result.accepted.map((fact) => fact.value)).toEqual(["7000"]);
    expect(result.refused).toHaveLength(1);
  });
});
