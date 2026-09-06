import "server-only";
import { getServerEnvironment } from "@/src/lib/env";

/**
 * Structured server-side diagnostics for the authentication path.
 *
 * This module exists because a failed sign-in collapsed several unrelated
 * causes into one opaque message: an RPC error, an empty result, and a missing
 * session all produced "This account is unavailable". Operators could not tell
 * a misconfigured project from an unprovisioned workspace.
 *
 * Nothing here may carry an email address, a password, a token, a session or a
 * user id. Callers pass error codes, counts and booleans only — enough to
 * locate a fault, never enough to identify a person.
 */

/**
 * The Supabase project reference taken from the configured URL.
 *
 * Public information: it is the hostname every browser request already goes to,
 * and it is not a credential. Logging it is what makes a project mismatch
 * visible in production, where the URL itself may be stored as a write-only
 * sensitive variable that nobody can read back.
 */
function supabaseProjectRef(): string {
  const url = getServerEnvironment().supabaseUrl;
  if (!url) return "unset";
  try {
    return new URL(url).hostname.split(".")[0] ?? "unknown";
  } catch {
    return "unparseable";
  }
}

export type AuthDiagnosticDetail = Readonly<Record<string, string | number | boolean>>;

export function logAuthDiagnostic(event: string, detail: AuthDiagnosticDetail = {}): void {
  // console.error so it reaches the platform's error stream, where failed
  // sign-ins are actually looked for.
  console.error(
    JSON.stringify({
      scope: "auth-diagnostic",
      event,
      supabaseProject: supabaseProjectRef(),
      ...detail
    })
  );
}
