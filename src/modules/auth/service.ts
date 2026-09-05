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

/**
 * What an existing account may present at the door.
 *
 * Deliberately weaker than `newPassword` below. Strengthening this would lock
 * out every account created before the stronger rule existed, which is a
 * self-inflicted outage rather than a security gain - the credential has
 * already been accepted, and refusing to let its owner in does not make it
 * stronger.
 */
const password = z.string().min(12).max(128);

/**
 * What a password may be when it is being set.
 *
 * Mirrors `password_requirements = "lower_upper_letters_digits"` in
 * supabase/config.toml. It has to be stated twice - once by the provider that
 * enforces it and once here - because the provider's refusal arrives as a
 * generic 422 that the form can only report as "email or password could not be
 * accepted", naming neither the field nor the rule. Checking first means the
 * person is told what is actually required.
 */
const newPassword = password
  .refine((value) => /[a-z]/.test(value), {
    error: "Password needs at least one lowercase letter."
  })
  .refine((value) => /[A-Z]/.test(value), {
    error: "Password needs at least one uppercase letter."
  })
  .refine((value) => /[0-9]/.test(value), {
    error: "Password needs at least one digit."
  });

const signupSchema = z.object({
  email,
  password: newPassword,
  businessName: z.string().trim().min(2).max(80)
});
const credentialsSchema = z.object({ email, password });

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly captcha: CaptchaProvider,
    private readonly rateLimiter: RateLimiter,
    private readonly emailConfirmationEnabled: boolean,
    private readonly signupEnabled = true,
    private readonly signupEmailAllowlist: readonly string[] = []
  ) {}

  async signup(input: SignupInput, context: AuthContext): Promise<Result<AuthOutcome>> {
    if (!this.signupEnabled) {
      return err(
        appError(
          "AUTH_SIGNUP_DISABLED",
          "Account creation is not available. Contact your workspace administrator."
        )
      );
    }
    const parsed = signupSchema.safeParse(input);
    if (!parsed.success) return weakPassword(parsed.error) ?? invalidInput();
    if (
      this.signupEmailAllowlist.length > 0 &&
      !this.signupEmailAllowlist.includes(parsed.data.email.toLowerCase())
    ) {
      return err(
        appError("AUTH_SIGNUP_DISABLED", "Account creation is not available for this email.")
      );
    }
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
    // The setting rule, not the door rule: choosing a new password is exactly
    // the moment the stronger requirement applies.
    const parsed = newPassword.safeParse(passwordInput);
    if (!parsed.success) return weakPassword(parsed.error) ?? invalidInput();
    return this.repository.resetPassword(parsed.data);
  }

  logout(allSessions = false) {
    return this.repository.logout(allSessions);
  }

  private async guard(operation: string, identity: string, context: AuthContext) {
    const limit = await this.rateLimiter.consume(
      `${operation}:${context.ipAddress}:${identity.toLowerCase()}`
    );
    if (!limit.ok) return limit;
    return this.captcha.verify(context.captchaToken, context.ipAddress, operation);
  }
}

function invalidInput<T>(): Result<T> {
  return err(appError("VALIDATION_ERROR", "Check the highlighted information and try again."));
}

/**
 * Turns a failed password rule into an error that names it.
 *
 * Returns undefined when nothing about the password was wrong, so the caller
 * falls back to the generic message: a rejected email or business name must not
 * be reported as a password problem. The message is carried through rather than
 * mapped to a fixed string, because "needs a digit" and "needs an uppercase
 * letter" are different instructions and collapsing them tells the person to
 * guess.
 */
function weakPassword<T>(error: z.ZodError): Result<T> | undefined {
  // An empty path is the reset flow, which parses the password on its own; the
  // signup flow parses an object, so there the password issue is the one keyed
  // to that field. Both are the password; neither is the email.
  const issue = error.issues.find(
    (candidate) => candidate.path.length === 0 || candidate.path[0] === "password"
  );
  if (!issue) return undefined;
  return err(appError("AUTH_PASSWORD_TOO_WEAK", issue.message));
}
