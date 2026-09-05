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
      // Distinct from AUTH_ACCOUNT_UNAVAILABLE: signup being switched off for
      // the whole deployment is not a statement about anyone's account, and
      // reporting it as one is what made this hard to diagnose in production.
      ok: false,
      error: { code: "AUTH_SIGNUP_DISABLED" }
    });
    expect(repo.signup).not.toHaveBeenCalled();
  });

  it("limits Preview signup to the configured owner identity", async () => {
    const repo = repository();
    const service = new AuthService(
      repo,
      new FakeCaptchaProvider(),
      new MemoryRateLimiter(3, 60_000),
      false,
      true,
      ["owner@example.test"]
    );
    await expect(
      service.signup(
        {
          email: "other@example.test",
          password: "Correct Horse 42",
          businessName: "Acme Test"
        },
        context
      )
    ).resolves.toMatchObject({ ok: false, error: { code: "AUTH_SIGNUP_DISABLED" } });
    expect(repo.signup).not.toHaveBeenCalled();
  });
});

/**
 * The password rules, which are two rules and not one.
 *
 * `password_requirements = "lower_upper_letters_digits"` in
 * supabase/config.toml is enforced by the provider, and until this was checked
 * here first the provider's refusal reached the person as "Email or password
 * could not be accepted" - naming neither the field nor the rule, under a hint
 * that promised only "At least 12 characters".
 */
describe("password requirements", () => {
  const service = () =>
    new AuthService(
      repository(),
      new FakeCaptchaProvider(),
      new MemoryRateLimiter(50, 60_000),
      false
    );

  const signupWith = (password: string) =>
    service().signup({ email: "owner@example.test", password, businessName: "Acme Test" }, context);

  it("names the missing character class instead of failing generically", async () => {
    const cases = [
      ["ALLUPPERCASE123", /lowercase/i],
      ["alllowercase123", /uppercase/i],
      ["NoDigitsInHere", /digit/i]
    ] as const;

    for (const [password, expected] of cases) {
      const result = await signupWith(password);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("AUTH_PASSWORD_TOO_WEAK");
      expect(result.error.message).toMatch(expected);
    }
  });

  it("accepts a password that satisfies every class", async () => {
    await expect(signupWith("Rellooma2026Test")).resolves.toMatchObject({ ok: true });
  });

  // A failure elsewhere in the form must not be reported as a password problem.
  it("does not blame the password for a bad email", async () => {
    const result = await service().signup(
      { email: "not-an-email", password: "Rellooma2026Test", businessName: "Acme Test" },
      context
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("applies the stronger rule when a password is being set by reset", async () => {
    const result = await service().resetPassword("nodigitsanywhere");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUTH_PASSWORD_TOO_WEAK");
  });

  /**
   * The rule at the door stays weaker on purpose. Strengthening it would lock
   * out every account created before the stronger rule existed - an outage, not
   * a security gain, since the credential has already been accepted.
   */
  it("still lets an existing weak password log in", async () => {
    await expect(
      service().login({ email: "owner@example.test", password: "alllowercasenodigits" }, context)
    ).resolves.toMatchObject({ ok: true });
  });
});
