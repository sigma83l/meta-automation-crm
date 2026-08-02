import { afterEach, describe, expect, it, vi } from "vitest";

import { TurnstileCaptchaProvider } from "@/src/modules/auth/adapters/captcha";

afterEach(() => vi.unstubAllGlobals());

describe("Turnstile production validation", () => {
  it("requires success, expected hostname, expected action and a fresh timestamp", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            hostname: "app.example.test",
            action: "signup",
            challenge_ts: new Date().toISOString()
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetcher);
    const provider = new TurnstileCaptchaProvider(
      "turnstile-test-secret-not-production",
      "app.example.test"
    );
    await expect(provider.verify("single-use-token", "127.0.0.1", "signup")).resolves.toEqual({
      ok: true,
      value: undefined
    });
    await expect(provider.verify("single-use-token", "127.0.0.1", "login")).resolves.toMatchObject({
      ok: false,
      error: { code: "AUTH_CAPTCHA_FAILED" }
    });
  });

  it("rejects expired or wrong-host responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              hostname: "attacker.example",
              action: "recovery",
              challenge_ts: new Date(Date.now() - 301_000).toISOString()
            }),
            { status: 200 }
          )
      )
    );
    const provider = new TurnstileCaptchaProvider(
      "turnstile-test-secret-not-production",
      "app.example.test"
    );
    await expect(
      provider.verify("single-use-token", "127.0.0.1", "recovery")
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AUTH_CAPTCHA_FAILED" }
    });
  });
});
