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
  constructor(private readonly secret: string) {}

  async verify(token: string, ipAddress: string): Promise<Result<void>> {
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
    const payload = (await response.json()) as { success?: boolean };
    return payload.success
      ? ok(undefined)
      : err(appError("AUTH_CAPTCHA_FAILED", "Human verification failed."));
  }
}
