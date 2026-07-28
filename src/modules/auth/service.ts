import { z } from "zod";

import { appError, err, ok, type Result } from "@/src/lib/result";

import type {
  AuthContext,
  AuthOutcome,
  AuthRepository,
  CaptchaProvider,
  Credentials,
  RateLimiter,
  SignupInput
} from "./contracts";

const email = z.string().trim().email().max(254);
const password = z.string().min(12).max(128);
const signupSchema = z.object({
  email,
  password,
  businessName: z.string().trim().min(2).max(80)
});
const credentialsSchema = z.object({ email, password });

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly captcha: CaptchaProvider,
    private readonly rateLimiter: RateLimiter,
    private readonly emailConfirmationEnabled: boolean
  ) {}

  async signup(input: SignupInput, context: AuthContext): Promise<Result<AuthOutcome>> {
    const parsed = signupSchema.safeParse(input);
    if (!parsed.success) return invalidInput();
    const guarded = await this.guard("signup", parsed.data.email, context);
    if (!guarded.ok) return guarded;
    return this.repository.signup(parsed.data, this.emailConfirmationEnabled);
  }

  async login(input: Credentials, context: AuthContext): Promise<Result<AuthOutcome>> {
    const parsed = credentialsSchema.safeParse(input);
    if (!parsed.success) return invalidInput();
    const guarded = await this.guard("login", parsed.data.email, context);
    if (!guarded.ok) return guarded;
    return this.repository.login(parsed.data);
  }

  async requestPasswordReset(emailInput: string, context: AuthContext): Promise<Result<void>> {
    const parsed = email.safeParse(emailInput);
    if (!parsed.success) return invalidInput();
    const guarded = await this.guard("recovery", parsed.data, context);
    if (!guarded.ok) return guarded;
    const result = await this.repository.requestPasswordReset(parsed.data);
    if (!result.ok && result.error.code !== "AUTH_RATE_LIMITED") return ok(undefined);
    return result;
  }

  async resetPassword(passwordInput: string): Promise<Result<void>> {
    const parsed = password.safeParse(passwordInput);
    if (!parsed.success) return invalidInput();
    return this.repository.resetPassword(parsed.data);
  }

  logout(allSessions = false) {
    return this.repository.logout(allSessions);
  }

  private async guard(operation: string, identity: string, context: AuthContext) {
    const limit = this.rateLimiter.consume(
      `${operation}:${context.ipAddress}:${identity.toLowerCase()}`
    );
    if (!limit.ok) return limit;
    return this.captcha.verify(context.captchaToken, context.ipAddress);
  }
}

function invalidInput<T>(): Result<T> {
  return err(appError("VALIDATION_ERROR", "Check the highlighted information and try again."));
}
