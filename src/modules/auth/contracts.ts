import type { Result } from "@/src/lib/result";

export type AuthContext = Readonly<{
  ipAddress: string;
  userAgent: string;
  captchaToken: string;
}>;

export type SignupInput = Readonly<{
  email: string;
  password: string;
  businessName: string;
}>;

export type Credentials = Readonly<{ email: string; password: string }>;

export type AuthOutcome = Readonly<{
  next: "/dashboard" | "/onboarding" | "/login";
  confirmationRequired?: boolean;
}>;

export interface AuthRepository {
  signup(input: SignupInput, emailConfirmationEnabled: boolean): Promise<Result<AuthOutcome>>;
  login(input: Credentials): Promise<Result<AuthOutcome>>;
  logout(allSessions: boolean): Promise<Result<void>>;
  requestPasswordReset(email: string): Promise<Result<void>>;
  resetPassword(password: string): Promise<Result<void>>;
}

export interface CaptchaProvider {
  verify(token: string, ipAddress: string): Promise<Result<void>>;
}

export interface RateLimiter {
  consume(key: string, now?: number): Result<void> | Promise<Result<void>>;
}
