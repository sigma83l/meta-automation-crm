import { describe, expect, it } from "vitest";
import {
  createSignedBillingCallbackState,
  verifySignedBillingCallbackState
} from "@/src/modules/billing/callback-state";

describe("billing callback state security", () => {
  const workspaceId = "00000000-0000-4000-8000-000000000001";
  const secret = "synthetic-billing-callback-secret";
  const issuedAt = Date.UTC(2026, 6, 29, 10, 0, 0);

  it("accepts an exact, unexpired signed state", () => {
    const state = createSignedBillingCallbackState(
      workspaceId,
      "card_registration",
      secret,
      issuedAt
    );
    expect(
      verifySignedBillingCallbackState(
        state,
        workspaceId,
        "card_registration",
        secret,
        issuedAt + 60_000
      )
    ).toBe(true);
  });

  it("rejects tampering, cross-workspace use, expiry and future timestamps", () => {
    const state = createSignedBillingCallbackState(
      workspaceId,
      "card_registration",
      secret,
      issuedAt
    );
    const tampered = `${state.slice(0, -1)}${state.endsWith("0") ? "1" : "0"}`;
    expect(
      verifySignedBillingCallbackState(
        tampered,
        workspaceId,
        "card_registration",
        secret,
        issuedAt + 1
      )
    ).toBe(false);
    expect(
      verifySignedBillingCallbackState(
        state,
        "00000000-0000-4000-8000-000000000002",
        "card_registration",
        secret,
        issuedAt + 1
      )
    ).toBe(false);
    expect(
      verifySignedBillingCallbackState(
        state,
        workspaceId,
        "card_registration",
        secret,
        issuedAt + 600_001
      )
    ).toBe(false);
    expect(
      verifySignedBillingCallbackState(
        state,
        workspaceId,
        "card_registration",
        secret,
        issuedAt - 1
      )
    ).toBe(false);
  });
});
