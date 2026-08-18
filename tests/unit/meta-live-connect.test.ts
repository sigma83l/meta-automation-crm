import { describe, expect, it } from "vitest";
import {
  channelFromMetaOauthState,
  createSignedMetaOauthState
} from "@/src/modules/integrations/meta/oauth-state";
import { buildSecurityHeaders } from "@/src/lib/security-headers";

const SECRET = "meta-app-secret-at-least-32-characters-long";

describe("the channel survives an Instagram redirect", () => {
  it("reads the channel out of a state we issued", () => {
    // Instagram's redirect carries only code and state: the redirect URI must
    // match the registered one byte for byte, so it cannot carry a channel of
    // our own.
    const state = createSignedMetaOauthState("ws_1", "instagram", SECRET);
    expect(channelFromMetaOauthState(state)).toBe("instagram");
  });

  it("reads whatsapp too", () => {
    expect(channelFromMetaOauthState(createSignedMetaOauthState("ws_1", "whatsapp", SECRET))).toBe(
      "whatsapp"
    );
  });

  it("returns null for a malformed state rather than guessing", () => {
    // A malformed state must not select a channel by accident; the signature
    // check that follows is what makes the value trustworthy.
    for (const state of ["", "nonsense", "a.b.c", "ws.telegram.1.2.3"]) {
      expect(`${state}:${channelFromMetaOauthState(state)}`).toBe(`${state}:null`);
    }
  });

  it("is not a trust boundary — it parses, it does not verify", () => {
    // A forged state parses fine here. That is intended: consumeMetaOauthState
    // is what rejects it, and this only decides which channel to check against.
    expect(channelFromMetaOauthState("ws_evil.whatsapp.1.2.badsignature")).toBe("whatsapp");
  });
});

describe("the CSP permits Meta's SDK and nothing more", () => {
  const csp = (production: boolean) =>
    buildSecurityHeaders(production).find((h) => h.key === "Content-Security-Policy")!.value;

  it("allows the SDK script origin", () => {
    // Without this the Embedded Signup dialog never opens, and the failure is
    // a console warning rather than anything the user sees.
    expect(csp(true)).toContain("https://connect.facebook.net");
  });

  it("allows the SDK's XHR and dialog origins", () => {
    expect(csp(true)).toMatch(/connect-src[^;]*graph\.facebook\.com/);
    expect(csp(true)).toMatch(/frame-src[^;]*www\.facebook\.com/);
  });

  it("keeps the existing Turnstile and Supabase allowances", () => {
    // Widening a CSP is exactly where a previous allowance gets dropped.
    const value = csp(true);
    expect(value).toContain("https://challenges.cloudflare.com");
    expect(value).toMatch(/connect-src[^;]*\*\.supabase\.co/);
  });

  it("still refuses everything by default", () => {
    const value = csp(true);
    expect(value).toContain("default-src 'self'");
    expect(value).toContain("object-src 'none'");
    expect(value).toContain("frame-ancestors 'none'");
  });

  it("does not allow eval in production", () => {
    expect(csp(true)).not.toContain("unsafe-eval");
    expect(csp(false)).toContain("unsafe-eval");
  });
});
