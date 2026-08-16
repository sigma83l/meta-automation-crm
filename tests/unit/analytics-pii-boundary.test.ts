import { describe, expect, it } from "vitest";
import {
  EXTERNAL_SAFE_PROPERTIES,
  NEVER_EXPORTED_PROPERTIES,
  isExternalSafe,
  looksLikePersonalData,
  toExternalProperties
} from "@/src/modules/analytics/pii-boundary";

describe("the boundary is an allowlist", () => {
  it("passes through the dimensions and measures analytics needs", () => {
    const { properties, dropped } = toExternalProperties({
      workspace_id: "ws_1",
      channel: "whatsapp",
      plan: "starter",
      count: 3,
      duration_ms: 1200
    });
    expect(properties).toEqual({
      workspace_id: "ws_1",
      channel: "whatsapp",
      plan: "starter",
      count: 3,
      duration_ms: 1200
    });
    expect(dropped).toEqual([]);
  });

  it("drops a field nobody has approved, rather than approving it by default", () => {
    // A blocklist approves every field nobody has thought about yet — which is
    // exactly the set that grows each time somebody adds a property.
    const { properties, dropped } = toExternalProperties({
      workspace_id: "ws_1",
      some_new_field_added_last_tuesday: "whatever"
    });
    expect(properties).toEqual({ workspace_id: "ws_1" });
    expect(dropped).toEqual(["some_new_field_added_last_tuesday"]);
  });

  it("reports what it dropped instead of discarding it silently", () => {
    // Otherwise somebody spends an afternoon on an empty chart and then
    // "fixes" it by widening the allowlist.
    expect(toExternalProperties({ message_text: "hello" }).dropped).toEqual(["message_text"]);
  });

  it("never lets an allowlisted name be a never-exported one", () => {
    // This is the test that catches somebody adding customer_phone to the
    // allowlist in a hurry.
    const overlap = EXTERNAL_SAFE_PROPERTIES.filter((name) =>
      NEVER_EXPORTED_PROPERTIES.includes(name)
    );
    expect(overlap).toEqual([]);
  });

  it("refuses every name on the never-exported list", () => {
    for (const name of NEVER_EXPORTED_PROPERTIES) {
      const { properties } = toExternalProperties({ [name]: "anything at all" });
      expect(`${name}:${Object.keys(properties).length}`).toBe(`${name}:0`);
    }
  });
});

describe("customer messages never cross", () => {
  it("drops the message body", () => {
    const { properties } = toExternalProperties({
      workspace_id: "ws_1",
      message_text: "Hi, is the blue one still available? My number is 0532 111 22 33"
    });
    expect(properties).toEqual({ workspace_id: "ws_1" });
  });

  it("drops a transcript", () => {
    expect(isExternalSafe({ transcript: ["hello", "hi"] })).toBe(false);
  });

  it("drops a nested object wholesale rather than recursing into it", () => {
    // A nested blob is the usual way a raw provider payload ends up somewhere
    // it should not be, and recursing would mean judging a shape nobody
    // declared.
    const { properties, dropped } = toExternalProperties({
      workspace_id: "ws_1",
      source: { utm: "newsletter", contact: { phone: "+905321112233" } }
    });
    expect(properties).toEqual({ workspace_id: "ws_1" });
    expect(dropped).toEqual(["source"]);
  });

  it("drops an array in a permitted field", () => {
    expect(toExternalProperties({ count: [1, 2, 3] }).dropped).toEqual(["count"]);
  });
});

describe("contents are checked, not only names", () => {
  it("drops a permitted field carrying an email address", () => {
    // The failure that actually happens: a permitted field carrying something
    // it should not, because somebody upstream used it as an identifier.
    const { properties, dropped } = toExternalProperties({
      workspace_id: "ws_1",
      source: "hamed@example.com"
    });
    expect(properties).toEqual({ workspace_id: "ws_1" });
    expect(dropped).toEqual(["source"]);
  });

  it("drops a permitted field carrying a phone number", () => {
    expect(toExternalProperties({ campaign: "+90 532 111 22 33" }).dropped).toEqual(["campaign"]);
  });

  it("drops a permitted field carrying a provider message id", () => {
    expect(toExternalProperties({ source: "wamid.HBgMOTA1MzIxMTEyMjMz" }).dropped).toEqual([
      "source"
    ]);
  });

  it("drops a permitted field carrying a URL, which may be a signed media link", () => {
    expect(
      toExternalProperties({ referrer_host: "https://lookaside.fbcdn.net/x?token=abc" }).dropped
    ).toEqual(["referrer_host"]);
  });

  it("recognises personal-looking data on its shape alone", () => {
    expect(looksLikePersonalData("someone@example.com")).toBe(true);
    expect(looksLikePersonalData("+905321112233")).toBe(true);
    expect(looksLikePersonalData("whatsapp")).toBe(false);
    expect(looksLikePersonalData(42)).toBe(false);
  });

  it("leaves an ordinary host name alone", () => {
    // Over-eager is the correct bias, but not so eager that nothing survives.
    expect(toExternalProperties({ referrer_host: "google.com" }).properties).toEqual({
      referrer_host: "google.com"
    });
  });
});

describe("empty values", () => {
  it("omits nulls without calling them dropped", () => {
    // Absent is not the same as refused, and conflating them would make the
    // drop count useless as a signal.
    const { properties, dropped } = toExternalProperties({
      workspace_id: "ws_1",
      campaign: null,
      variant: undefined
    });
    expect(properties).toEqual({ workspace_id: "ws_1" });
    expect(dropped).toEqual([]);
  });

  it("reports an empty payload as safe", () => {
    expect(isExternalSafe({})).toBe(true);
  });
});
