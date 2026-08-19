import { describe, expect, it, vi } from "vitest";
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

type LoginCall = {
  callback: (response: unknown) => void;
  options: Record<string, unknown>;
};

/** The config the panel passes; both identifiers are real public values. */
const CONFIG = {
  appId: "1597160428639176",
  configId: "890825840460092",
  graphVersion: "v25.0"
} as const;

/**
 * Runs a body against a stubbed window carrying Meta's SDK and the message
 * channel the dialog answers on.
 *
 * The suite is a node environment, so `window` is whatever we say it is. That
 * is the point: the two things the flow depends on - FB.login and a `message`
 * listener - are exactly what is stubbed, and nothing else is available to
 * lean on by accident.
 */
const withWindow = async (
  fb: unknown,
  run: (
    module: typeof import("@/src/modules/integrations/meta/embedded-signup"),
    channel: {
      post: (event: { origin?: string; data?: unknown }) => void;
      listenerCount: () => number;
    }
  ) => Promise<void> | void
) => {
  const listeners = new Set<(event: { origin?: string; data?: unknown }) => void>();
  const globalWindow = globalThis as unknown as { window?: unknown };
  const previous = globalWindow.window;
  globalWindow.window = {
    FB: fb,
    addEventListener: (
      type: string,
      listener: (event: { origin?: string; data?: unknown }) => void
    ) => {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener: (
      type: string,
      listener: (event: { origin?: string; data?: unknown }) => void
    ) => {
      if (type === "message") listeners.delete(listener);
    }
  };
  try {
    await run(await import("@/src/modules/integrations/meta/embedded-signup"), {
      post: (event) => {
        for (const listener of [...listeners]) listener(event);
      },
      listenerCount: () => listeners.size
    });
  } finally {
    if (previous === undefined) delete globalWindow.window;
    else globalWindow.window = previous;
  }
};

/** An SDK that records its init options and parks each login callback. */
const recordingSdk = () => {
  const init: Record<string, unknown>[] = [];
  const logins: LoginCall[] = [];
  return {
    init,
    logins,
    fb: {
      init: (options: Record<string, unknown>) => init.push(options),
      login: (callback: (response: unknown) => void, options: Record<string, unknown>) =>
        logins.push({ callback, options })
    }
  };
};

/** The message Meta posts when the user finishes the dialog. Sent as JSON. */
const finishMessage = (waba: string, phone: string) => ({
  origin: "https://www.facebook.com",
  data: JSON.stringify({
    type: "WA_EMBEDDED_SIGNUP",
    event: "FINISH",
    data: { waba_id: waba, phone_number_id: phone }
  })
});

describe("the SDK is initialised at the point of use", () => {
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
      void module.launchEmbeddedSignup(CONFIG);
      await Promise.resolve();
      expect(calls).toEqual(["init", "login"]);
    });
  });

  it("initialises with the app id and version it was given", async () => {
    const sdk = recordingSdk();
    await withWindow(sdk.fb, async (module) => {
      void module.launchEmbeddedSignup(CONFIG);
      await Promise.resolve();
      expect(sdk.init[0]).toMatchObject({ appId: CONFIG.appId, version: CONFIG.graphVersion });
    });
  });
});

describe("the WhatsApp assets are taken from the dialog's message", () => {
  it("resolves with the code and the assets the user chose", async () => {
    // The code says the user authorised something; it does not say which
    // portfolio or which number. Only this message does, and the server needs
    // both to verify the pair before storing it.
    const sdk = recordingSdk();
    await withWindow(sdk.fb, async (module, channel) => {
      const pending = module.launchEmbeddedSignup(CONFIG);
      channel.post(finishMessage("102290129340398", "106540352242922"));
      sdk.logins[0]!.callback({ authResponse: { code: "auth-code" }, status: "connected" });
      await expect(pending).resolves.toEqual({
        code: "auth-code",
        wabaId: "102290129340398",
        phoneNumberId: "106540352242922"
      });
    });
  });

  it("still resolves when the message arrives after the code", async () => {
    // Nothing specifies the order of the message against the login callback.
    // The observed order is message first, so this is the case that would rot
    // silently if the wait were not there.
    const sdk = recordingSdk();
    await withWindow(sdk.fb, async (module, channel) => {
      const pending = module.launchEmbeddedSignup(CONFIG);
      sdk.logins[0]!.callback({ authResponse: { code: "auth-code" }, status: "connected" });
      channel.post(finishMessage("102290129340398", "106540352242922"));
      await expect(pending).resolves.toMatchObject({ wabaId: "102290129340398" });
    });
  });

  it("accepts a payload that is already an object", async () => {
    // Documented as a JSON string, and that is what arrives. Parsing what is
    // already parsed costs nothing and removes a version dependency.
    const sdk = recordingSdk();
    await withWindow(sdk.fb, async (module, channel) => {
      const pending = module.launchEmbeddedSignup(CONFIG);
      channel.post({
        origin: "https://web.facebook.com",
        data: {
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH",
          data: { waba_id: "102290129340398", phone_number_id: "106540352242922" }
        }
      });
      sdk.logins[0]!.callback({ authResponse: { code: "auth-code" } });
      await expect(pending).resolves.toMatchObject({ phoneNumberId: "106540352242922" });
    });
  });

  const foreignMessage = {
    origin: "https://facebook.com.attacker.example",
    data: JSON.stringify({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: { waba_id: "666666666666666", phone_number_id: "666666666666666" }
    })
  };

  it("ignores a message from any other origin", async () => {
    // A `message` listener hears from anyone holding a handle to this window.
    // Without the origin check, a foreign page could name the portfolio that
    // gets stored against the workspace. A well-shaped message from the wrong
    // host has to leave the flow exactly as empty-handed as no message at all.
    vi.useFakeTimers();
    try {
      const sdk = recordingSdk();
      await withWindow(sdk.fb, async (module, channel) => {
        const pending = module.launchEmbeddedSignup(CONFIG);
        const assertion = expect(pending).rejects.toThrow("META_WHATSAPP_ASSET_MISSING");
        channel.post(foreignMessage);
        sdk.logins[0]!.callback({ authResponse: { code: "auth-code" } });
        await vi.advanceTimersByTimeAsync(2000);
        await assertion;
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a later foreign message replace the real one", async () => {
    const sdk = recordingSdk();
    await withWindow(sdk.fb, async (module, channel) => {
      const pending = module.launchEmbeddedSignup(CONFIG);
      channel.post(finishMessage("102290129340398", "106540352242922"));
      channel.post(foreignMessage);
      sdk.logins[0]!.callback({ authResponse: { code: "auth-code" } });
      await expect(pending).resolves.toMatchObject({ wabaId: "102290129340398" });
    });
  });

  it("survives unrelated traffic on the message channel", async () => {
    const sdk = recordingSdk();
    await withWindow(sdk.fb, async (module, channel) => {
      const pending = module.launchEmbeddedSignup(CONFIG);
      channel.post({ origin: "https://www.facebook.com", data: "not json at all" });
      channel.post({ origin: "https://www.facebook.com", data: JSON.stringify({ type: "OTHER" }) });
      channel.post({ data: JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH" }) });
      channel.post(finishMessage("102290129340398", "106540352242922"));
      sdk.logins[0]!.callback({ authResponse: { code: "auth-code" } });
      await expect(pending).resolves.toMatchObject({ code: "auth-code" });
    });
  });

  it("names the missing phone number rather than failing server-side", async () => {
    // A portfolio with no number on it is a real and recoverable state. The
    // exchange would refuse it anyway, but only after a round trip and under a
    // message that says nothing about adding a number.
    const sdk = recordingSdk();
    await withWindow(sdk.fb, async (module, channel) => {
      const pending = module.launchEmbeddedSignup(CONFIG);
      const assertion = expect(pending).rejects.toThrow("META_WHATSAPP_PHONE_REQUIRED");
      channel.post({
        origin: "https://www.facebook.com",
        data: JSON.stringify({
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH_ONLY_WABA",
          data: { waba_id: "102290129340398" }
        })
      });
      await assertion;
    });
  });

  it("reports a cancelled dialog as cancelled", async () => {
    const sdk = recordingSdk();
    await withWindow(sdk.fb, async (module, channel) => {
      const pending = module.launchEmbeddedSignup(CONFIG);
      const assertion = expect(pending).rejects.toThrow("META_CANCELLED");
      channel.post({
        origin: "https://www.facebook.com",
        data: JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: {} })
      });
      await assertion;
    });
  });

  it("gives up on a code that never gets its assets", async () => {
    // Rather than sending the exchange a request the server can only refuse.
    vi.useFakeTimers();
    try {
      const sdk = recordingSdk();
      await withWindow(sdk.fb, async (module) => {
        const pending = module.launchEmbeddedSignup(CONFIG);
        const assertion = expect(pending).rejects.toThrow("META_WHATSAPP_ASSET_MISSING");
        sdk.logins[0]!.callback({ authResponse: { code: "auth-code" } });
        await vi.advanceTimersByTimeAsync(2000);
        await assertion;
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops listening once it has settled", async () => {
    // The panel can be clicked again after a failure, and every attempt that
    // left its listener behind would answer for the next one.
    const sdk = recordingSdk();
    await withWindow(sdk.fb, async (module, channel) => {
      const pending = module.launchEmbeddedSignup(CONFIG);
      expect(channel.listenerCount()).toBe(1);
      channel.post(finishMessage("102290129340398", "106540352242922"));
      sdk.logins[0]!.callback({ authResponse: { code: "auth-code" } });
      await pending;
      expect(channel.listenerCount()).toBe(0);
    });
  });

  it("asks Meta for a code, not a token", async () => {
    // A token returned to the browser would be a live credential in client
    // code. A code is useless without the app secret.
    const sdk = recordingSdk();
    await withWindow(sdk.fb, async (module) => {
      void module.launchEmbeddedSignup(CONFIG);
      await Promise.resolve();
      expect(sdk.logins[0]!.options).toMatchObject({
        config_id: CONFIG.configId,
        response_type: "code",
        override_default_response_type: true
      });
    });
  });

  it("opts into the session-info messages it then waits for", async () => {
    // The bug this guards, and it was silent in exactly the worst way: the
    // listener, the origin check and the grace window were all written and
    // tested against messages this call never asked Meta to send. Every test
    // above posts its own message, so every one of them passed while the real
    // dialog posted nothing at all.
    const sdk = recordingSdk();
    await withWindow(sdk.fb, async (module) => {
      void module.launchEmbeddedSignup(CONFIG);
      await Promise.resolve();
      expect(sdk.logins[0]!.options.extras).toMatchObject({ sessionInfoVersion: "3" });
    });
  });

  it("says so when the account is on the Business app rather than the API", async () => {
    // A real choice in the dialog with a real consequence: no phone number id,
    // so nothing can be sent. Without this it read as a generic timeout.
    const sdk = recordingSdk();
    await withWindow(sdk.fb, async (module, channel) => {
      const pending = module.launchEmbeddedSignup(CONFIG);
      const assertion = expect(pending).rejects.toThrow("META_WHATSAPP_APP_NOT_API");
      channel.post({
        origin: "https://www.facebook.com",
        data: JSON.stringify({
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
          data: { waba_id: "102290129340398" }
        })
      });
      await assertion;
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
    expect(await parse("890825840460092")).toBe(true);
    expect(await parse("1597160428639176")).toBe(true);
  });

  it("rejects a number too short to be either", async () => {
    // A stray "1" or a truncated paste is not a Meta identifier.
    expect(await parse("1")).toBe(false);
    expect(await parse("12345")).toBe(false);
  });
});
