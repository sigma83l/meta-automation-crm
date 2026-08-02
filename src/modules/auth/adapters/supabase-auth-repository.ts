import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { appError, err, ok, type Result } from "@/src/lib/result";

import type { AuthOutcome, AuthRepository, Credentials, SignupInput } from "../contracts";

type WorkspaceResolution = { workspace_id: string };

export class SupabaseAuthRepository implements AuthRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly appUrl: string
  ) {}

  async signup(
    input: SignupInput,
    emailConfirmationEnabled: boolean
  ): Promise<Result<AuthOutcome>> {
    const { data, error } = await this.client.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: { business_name: input.businessName },
        emailRedirectTo: `${this.appUrl}/auth/callback?next=/onboarding`
      }
    });
    if (error) return mapAuthError(error.message, error.status);
    if (emailConfirmationEnabled && !data.session) {
      return ok({ next: "/login", confirmationRequired: true });
    }
    if (!data.session) return unavailable();
    // Managed Better Auth sets its secure session cookie on the response. The
    // database trigger has already provisioned the workspace atomically, while
    // authenticated resolution is intentionally deferred to the next request.
    if (
      (this.client as unknown as { __applicationProvider?: string }).__applicationProvider ===
      "neon"
    ) {
      return ok({ next: "/onboarding" });
    }
    const workspace = await this.resolveWorkspace();
    if (!workspace.ok) {
      await this.client.auth.signOut({ scope: "global" });
      return workspace;
    }
    return ok({ next: "/onboarding" });
  }

  async login(input: Credentials): Promise<Result<AuthOutcome>> {
    const { error } = await this.client.auth.signInWithPassword(input);
    if (error) return mapAuthError(error.message, error.status);
    const workspace = await this.resolveWorkspace();
    if (!workspace.ok) {
      await this.client.auth.signOut({ scope: "global" });
      return unavailable();
    }
    await this.audit("login_succeeded");
    return ok({ next: "/dashboard" });
  }

  async logout(allSessions: boolean): Promise<Result<void>> {
    await this.audit(allSessions ? "logout_all_succeeded" : "logout_succeeded");
    const { error } = await this.client.auth.signOut({ scope: allSessions ? "global" : "local" });
    return error ? mapAuthError(error.message, error.status) : ok(undefined);
  }

  async requestPasswordReset(email: string): Promise<Result<void>> {
    const { error } = await this.client.auth.resetPasswordForEmail(email, {
      redirectTo: `${this.appUrl}/auth/callback?next=/reset-password`
    });
    return error ? mapAuthError(error.message, error.status) : ok(undefined);
  }

  async resetPassword(password: string): Promise<Result<void>> {
    const { error } = await this.client.auth.updateUser({ password });
    if (error) return mapAuthError(error.message, error.status);
    await this.audit("password_reset_completed");
    return ok(undefined);
  }

  private async resolveWorkspace(): Promise<Result<WorkspaceResolution>> {
    const { data, error } = await this.client.rpc("resolve_workspace", { workspace_hint: null });
    const row = Array.isArray(data) ? (data[0] as WorkspaceResolution | undefined) : undefined;
    return error || !row ? unavailable() : ok(row);
  }

  private async audit(eventType: string) {
    await this.client.rpc("record_auth_audit", {
      requested_event_type: eventType,
      requested_metadata: {}
    });
  }
}

function unavailable<T>(): Result<T> {
  return err(appError("AUTH_ACCOUNT_UNAVAILABLE", "This account cannot access a workspace."));
}

function mapAuthError<T>(message: string, status?: number): Result<T> {
  if (status === 429 || message.toLowerCase().includes("rate limit")) {
    return err(
      appError("AUTH_RATE_LIMITED", "Too many attempts. Try again shortly.", {
        retryable: true
      })
    );
  }
  if (message.toLowerCase().includes("session")) {
    return err(appError("AUTH_SESSION_EXPIRED", "Your session has expired."));
  }
  return err(appError("AUTH_INVALID_CREDENTIALS", "The request could not be completed."));
}
