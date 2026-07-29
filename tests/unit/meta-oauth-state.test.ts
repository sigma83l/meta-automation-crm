import { describe, expect, it } from "vitest";
import {
  createSignedMetaOauthState,
  verifySignedMetaOauthState
} from "@/src/modules/integrations/meta/oauth-state";

describe("Meta OAuth state security", () => {
  const workspaceId = "00000000-0000-4000-8000-000000000001";
  const secret = "synthetic-oauth-state-secret";
  const issuedAt = Date.UTC(2026, 6, 29, 10, 0, 0);

  it("accepts an exact, unexpired signed state", () => {
    const state = createSignedMetaOauthState(workspaceId, "instagram", secret, issuedAt);
    expect(
      verifySignedMetaOauthState(state, workspaceId, "instagram", secret, issuedAt + 60_000)
    ).toBe(true);
  });

  it("rejects tampering, cross-workspace use, expiry and future timestamps", () => {
    const state = createSignedMetaOauthState(workspaceId, "whatsapp", secret, issuedAt);
    expect(
      verifySignedMetaOauthState(
        `${state.slice(0, -1)}0`,
        workspaceId,
        "whatsapp",
        secret,
        issuedAt + 1
      )
    ).toBe(false);
    expect(
      verifySignedMetaOauthState(
        state,
        "00000000-0000-4000-8000-000000000002",
        "whatsapp",
        secret,
        issuedAt + 1
      )
    ).toBe(false);
    expect(
      verifySignedMetaOauthState(state, workspaceId, "whatsapp", secret, issuedAt + 600_001)
    ).toBe(false);
    expect(verifySignedMetaOauthState(state, workspaceId, "whatsapp", secret, issuedAt - 1)).toBe(
      false
    );
  });
});
