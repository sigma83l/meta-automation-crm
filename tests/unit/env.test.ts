import { describe, expect, it } from "vitest";
import { configuredInfrastructure, parseServerEnvironment } from "@/src/lib/env";

describe("environment contract", () => {
  it("defaults to sandbox-safe local settings", () => {
    const environment = parseServerEnvironment({});

    expect(environment.appUrl).toBe("http://localhost:3000");
    expect(environment.liveProviderSendEnabled).toBe(false);
    expect(environment.liveTestRecipientAllowlist).toEqual([]);
    expect(configuredInfrastructure(environment)).toEqual({
      supabase: false,
      inngest: false,
      credentialEncryption: false,
      liveSending: false
    });
  });

  it("rejects malformed public origins", () => {
    expect(() =>
      parseServerEnvironment({
        NEXT_PUBLIC_APP_URL: "not a valid origin"
      })
    ).toThrow();
  });

  it("parses an explicit allowlist without leaking it to public code", () => {
    const environment = parseServerEnvironment({
      LIVE_TEST_RECIPIENT_ALLOWLIST: "synthetic-1, synthetic-2 ",
      LIVE_PROVIDER_SEND_ENABLED: "true"
    });

    expect(environment.liveTestRecipientAllowlist).toEqual(["synthetic-1", "synthetic-2"]);
    expect(environment.liveProviderSendEnabled).toBe(true);
  });
});
