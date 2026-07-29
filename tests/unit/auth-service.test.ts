import { describe, expect, it, vi } from "vitest";

import { appError, err, ok } from "@/src/lib/result";
import { FakeCaptchaProvider } from "@/src/modules/auth/adapters/captcha";
import { MemoryRateLimiter } from "@/src/modules/auth/adapters/rate-limiter";
import type { AuthRepository } from "@/src/modules/auth/contracts";
import { AuthService } from "@/src/modules/auth/service";

function repository(): AuthRepository {
  return {
    signup: vi.fn(async (_input, confirmation) =>
      ok(
        confirmation
          ? { next: "/login" as const, confirmationRequired: true }
          : { next: "/onboarding" as const }
      )
    ),
    login: vi.fn(async () => ok({ next: "/dashboard" as const })),
    logout: vi.fn(async () => ok(undefined)),
    requestPasswordReset: vi.fn(async () => ok(undefined)),
    resetPassword: vi.fn(async () => ok(undefined))
  };
}

const context = { ipAddress: "127.0.0.1", userAgent: "test", captchaToken: "local-pass" };

describe("AuthService", () => {
  it("requires a 12-character password", async () => {
    const service = new AuthService(
      repository(),
      new FakeCaptchaProvider(),
      new MemoryRateLimiter(3, 60_000),
      false
    );
    const result = await service.signup(
      { email: "owner@example.test", password: "too-short", businessName: "Acme Test" },
      context
    );
    expect(result).toEqual(expect.objectContaining({ ok: false }));
  });

  it("supports confirmation disabled and enabled contracts", async () => {
    const disabled = new AuthService(
      repository(),
      new FakeCaptchaProvider(),
      new MemoryRateLimiter(3, 60_000),
      false
    );
    const enabled = new AuthService(
      repository(),
      new FakeCaptchaProvider(),
      new MemoryRateLimiter(3, 60_000),
      true
    );
    const input = {
      email: "owner@example.test",
      password: "Correct Horse 42",
      businessName: "Acme Test"
    };
    await expect(disabled.signup(input, context)).resolves.toMatchObject({
      ok: true,
      value: { next: "/onboarding" }
    });
    await expect(enabled.signup(input, context)).resolves.toMatchObject({
      ok: true,
      value: { confirmationRequired: true }
    });
  });

  it("fails CAPTCHA and returns a safe rate limit", async () => {
    const service = new AuthService(
      repository(),
      new FakeCaptchaProvider(),
      new MemoryRateLimiter(1, 60_000),
      false
    );
    const input = { email: "owner@example.test", password: "Correct Horse 42" };
    await expect(service.login(input, { ...context, captchaToken: "bad" })).resolves.toMatchObject({
      ok: false,
      error: { code: "AUTH_CAPTCHA_FAILED" }
    });
    await expect(service.login(input, context)).resolves.toMatchObject({
      ok: false,
      error: { code: "AUTH_RATE_LIMITED" }
    });
  });

  it("does not enumerate recovery accounts", async () => {
    const repo = repository();
    repo.requestPasswordReset = vi.fn(async () =>
      err(appError("UNEXPECTED_ERROR", "internal detail"))
    );
    const service = new AuthService(
      repo,
      new FakeCaptchaProvider(),
      new MemoryRateLimiter(3, 60_000),
      false
    );
    await expect(service.requestPasswordReset("missing@example.test", context)).resolves.toEqual(
      ok(undefined)
    );
  });

  it("exposes a logout-all service contract", async () => {
    const repo = repository();
    const service = new AuthService(
      repo,
      new FakeCaptchaProvider(),
      new MemoryRateLimiter(3, 60_000),
      false
    );
    await service.logout(true);
    expect(repo.logout).toHaveBeenCalledWith(true);
  });

  it("fails closed when production signup is invite-only", async () => {
    const repo = repository();
    const service = new AuthService(
      repo,
      new FakeCaptchaProvider(),
      new MemoryRateLimiter(3, 60_000),
      false,
      false
    );
    await expect(
      service.signup(
        {
          email: "owner@example.test",
          password: "Correct Horse 42",
          businessName: "Acme Test"
        },
        context
      )
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AUTH_ACCOUNT_UNAVAILABLE" }
    });
    expect(repo.signup).not.toHaveBeenCalled();
  });
});
