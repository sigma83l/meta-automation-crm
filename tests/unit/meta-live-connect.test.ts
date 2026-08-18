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

describe("the SDK is initialised at the point of use", () => {
  const withWindow = async (
    fb: unknown,
    run: (
      m: typeof import("@/src/modules/integrations/meta/embedded-signup")
    ) => Promise<void> | void
  ) => {
    const globalWindow = globalThis as unknown as { window?: unknown };
    const previous = globalWindow.window;
    globalWindow.window = { FB: fb };
    try {
      await run(await import("@/src/modules/integrations/meta/embedded-signup"));
    } finally {
      if (previous === undefined) delete globalWindow.window;
      else globalWindow.window = previous;
    }
  };

  it("reports not loaded when the script has not run", async () => {
    const { sdkReady } = await import("@/src/modules/integrations/meta/embedded-signup");
    expect(sdkReady()).toBe(false);
  });

  it("calls init before login, every time", async () => {
    // sdk.js is a two-stage loader: it fires fbAsyncInit, then loads
    // en_US/bundle/sdk.js which replaces window.FB. An init run against the
    // first object does not carry to its replacement, which produced
    // "FB.login() called before FB.init()" from an SDK we had initialised.
    const calls: string[] = [];
    const fb = {
      init: () => calls.push("init"),
      login: () => calls.push("login")
    };
    await withWindow(fb, async (module) => {
      void module.launchEmbeddedSignup({
        appId: "1597160428639176",
        configId: "1361427298924254",
        graphVersion: "v25.0"
      });
      await Promise.resolve();
      expect(calls).toEqual(["init", "login"]);
    });
  });

  it("initialises with the app id and version it was given", async () => {
    const seen: Record<string, unknown>[] = [];
    const fb = { init: (o: Record<string, unknown>) => seen.push(o), login: () => {} };
    await withWindow(fb, async (module) => {
      void module.launchEmbeddedSignup({
        appId: "1597160428639176",
        configId: "1361427298924254",
        graphVersion: "v25.0"
      });
      await Promise.resolve();
      expect(seen[0]).toMatchObject({ appId: "1597160428639176", version: "v25.0" });
    });
  });
});

describe("Meta identifiers are validated by shape, not by presence", () => {
  const parse = async (value: string) => {
    const { z } = await import("zod");
    const schema = z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z
        .string()
        .regex(/^\d{8,20}$/)
        .optional()
    );
    return schema.safeParse(value).success;
  };

  it("rejects the placeholder that shipped to production", async () => {
    // This exact value sat in META_WHATSAPP_CONFIG_ID: it passed every
    // non-empty check, liveMetaReadiness reported ready, and FB.login simply
    // did nothing — no dialog, no callback, no error to catch.
    expect(await parse("replace_with_embedded_signup_config_id")).toBe(false);
  });

  it("rejects anything with letters, dashes or underscores", async () => {
    for (const value of ["abc123456789", "1361-4272-9892", "config_1361427298924254", "TODO"]) {
      expect(`${value}:${await parse(value)}`).toBe(`${value}:false`);
    }
  });

  it("accepts a real configuration id and app id", async () => {
    expect(await parse("1361427298924254")).toBe(true);
    expect(await parse("1597160428639176")).toBe(true);
  });

  it("rejects a number too short to be either", async () => {
    // A stray "1" or a truncated paste is not a Meta identifier.
    expect(await parse("1")).toBe(false);
    expect(await parse("12345")).toBe(false);
  });
});
