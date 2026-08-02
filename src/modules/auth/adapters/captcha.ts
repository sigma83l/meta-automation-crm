import { appError, err, ok, type Result } from "@/src/lib/result";

import type { CaptchaProvider } from "../contracts";

export class FakeCaptchaProvider implements CaptchaProvider {
  async verify(token: string): Promise<Result<void>> {
    return token === "local-pass"
      ? ok(undefined)
      : err(appError("AUTH_CAPTCHA_FAILED", "Human verification failed."));
  }
}

export class TurnstileCaptchaProvider implements CaptchaProvider {
  constructor(
    private readonly secret: string,
    private readonly expectedHostname: string
  ) {}

  async verify(token: string, ipAddress: string, action: string): Promise<Result<void>> {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({
        secret: this.secret,
        response: token,
        remoteip: ipAddress
      }),
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) {
      return err(
        appError("PROVIDER_UNAVAILABLE", "Human verification is unavailable.", {
          retryable: true
        })
      );
    }
    const payload = (await response.json()) as {
      success?: boolean;
      action?: string;
      hostname?: string;
      challenge_ts?: string;
    };
    const issuedAt = payload.challenge_ts ? Date.parse(payload.challenge_ts) : Number.NaN;
    const fresh =
      Number.isFinite(issuedAt) && issuedAt <= Date.now() && Date.now() - issuedAt <= 300_000;
    return payload.success &&
      payload.action === action &&
      payload.hostname === this.expectedHostname &&
      fresh
      ? ok(undefined)
      : err(appError("AUTH_CAPTCHA_FAILED", "Human verification failed."));
  }
}
