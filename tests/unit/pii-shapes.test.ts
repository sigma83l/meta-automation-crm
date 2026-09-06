import { describe, expect, it } from "vitest";
import {
  isIsoTimestamp,
  looksLikePersonalData,
  structureCarriesPersonalData
} from "@/src/modules/security/pii-shapes";
import { toExternalProperties } from "@/src/modules/analytics/pii-boundary";

describe("timestamps are not phone numbers", () => {
  it("passes an ISO instant through the boundary", () => {
    // Regression: a phone pattern of "digits and punctuation" matches
    // 2026-08-19T12:00:00.000Z exactly, which silently dropped occurred_at from
    // every event that carried one — and the person debugging the empty column
    // fixes that by weakening the check.
    expect(looksLikePersonalData("2026-08-19T12:00:00.000Z")).toBe(false);
    expect(toExternalProperties({ occurred_at: "2026-08-19T12:00:00.000Z" }).dropped).toEqual([]);
  });

  it("recognises the timestamp spellings that actually occur", () => {
    for (const value of [
      "2026-08-19",
      "2026-08-19T12:00:00Z",
      "2026-08-19T12:00:00.000Z",
      "2026-08-19T12:00:00+03:00",
      "2026-08-19 12:00:00"
    ]) {
      expect(`${value}:${isIsoTimestamp(value)}`).toBe(`${value}:true`);
    }
  });

  it("does not mistake a phone number for a timestamp", () => {
    // The exclusion must be narrow, or it becomes the hole.
    expect(isIsoTimestamp("+90 532 111 22 33")).toBe(false);
    expect(looksLikePersonalData("+90 532 111 22 33")).toBe(true);
  });

  it("still catches a phone number sitting next to a date", () => {
    expect(looksLikePersonalData("called 2026-08-19 on +905321112233")).toBe(true);
  });
});

describe("personal shapes are caught wherever they sit", () => {
  it("catches an email, a phone, a message id and a URL", () => {
    for (const value of [
      "someone@example.com",
      "+905321112233",
      "wamid.HBgMOTA1MzIxMTEyMjMz",
      "https://lookaside.fbcdn.net/x?token=abc"
    ]) {
      expect(`${value}:${looksLikePersonalData(value)}`).toBe(`${value}:true`);
    }
  });

  it("leaves ordinary values alone", () => {
    for (const value of ["whatsapp", "starter", "ws_1", "google.com", "2026", ""]) {
      expect(`${value}:${looksLikePersonalData(value)}`).toBe(`${value}:false`);
    }
  });

  it("ignores non-strings", () => {
    for (const value of [42, true, null, undefined, {}]) {
      expect(`${String(value)}:${looksLikePersonalData(value)}`).toBe(`${String(value)}:false`);
    }
  });
});

describe("scanning a whole structure", () => {
  it("finds personal data nested at any depth", () => {
    expect(
      structureCarriesPersonalData({ a: { b: { c: ["hello", "someone@example.com"] } } })
    ).toBe(true);
  });

  it("finds it in a key as well as a value", () => {
    expect(structureCarriesPersonalData({ "wamid.HBgMOTA1": 1 })).toBe(true);
  });

  it("passes a structure whose only digits are its own timestamps", () => {
    // A record of counts and dates is exactly what a tombstone is.
    expect(
      structureCarriesPersonalData({
        workspaceId: "ws_1",
        deletedAt: "2026-08-19T12:00:00.000Z",
        purgedCounts: { customers: 412, messages: 9003 }
      })
    ).toBe(false);
  });

  it("still catches a phone number in a structure full of timestamps", () => {
    expect(
      structureCarriesPersonalData({
        deletedAt: "2026-08-19T12:00:00.000Z",
        contact: "+90 532 111 22 33"
      })
    ).toBe(true);
  });
});
