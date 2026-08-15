import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { appError, err, ok, type Result } from "@/src/lib/result";

import type { AuthOutcome, AuthRepository, Credentials, SignupInput } from "../contracts";
import { logAuthDiagnostic } from "../diagnostics";

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

    // A user without a session is Supabase telling us the project requires
    // email confirmation. That response is authoritative; the environment flag
    // is a second copy of the same fact and the two can drift. When they did,
    // this fell through to unavailable() and reported a successfully created
    // account as unusable, with no way to tell the two apart.
    if (!data.session) {
      if (data.user) {
        logAuthDiagnostic("signup_awaiting_email_confirmation", {
          flagSaysConfirmationEnabled: emailConfirmationEnabled
        });
        return ok({ next: "/login", confirmationRequired: true });
      }
      // No user and no session: the provider accepted nothing.
      logAuthDiagnostic("signup_returned_no_user");
      return unavailable();
    }
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
    if (error) {
      // Distinguishes a genuinely wrong password from a project misconfiguration
      // — an anon key issued by a different project than the configured URL
      // fails here, not later, and says so in the status.
      logAuthDiagnostic("password_sign_in_failed", {
        status: error.status ?? 0,
        code: error.code ?? "none"
      });
      return mapAuthError(error.message, error.status);
    }
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
    if (!error && row) return ok(row);

    // Three very different faults previously produced one identical message:
    // the RPC failed, the RPC returned nothing, or no session was attached so
    // auth.uid() was null inside it. Separate them, at the cost of one extra
    // round trip on the failure path only.
    if (error) {
      logAuthDiagnostic("resolve_workspace_error", {
        code: error.code ?? "none",
        message: error.message.slice(0, 200)
      });
      return unavailable();
    }

    const { data: session } = await this.client.auth.getUser();
    logAuthDiagnostic("resolve_workspace_empty", {
      rows: Array.isArray(data) ? data.length : 0,
      // If this is false the JWT never reached the RPC, so auth.uid() was null
      // and the query could not have matched regardless of the data.
      sessionAttached: Boolean(session?.user)
    });
    return unavailable();
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
