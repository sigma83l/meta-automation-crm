import { NextResponse } from "next/server";
import { getServerEnvironment } from "@/src/lib/env";
import { buildHealthPayload, type SupabaseReachability } from "@/src/lib/health";

export const dynamic = "force-dynamic";

/**
 * Asks the database whether it is actually there.
 *
 * Reporting only that environment variables are set made an unreachable or
 * wrongly-configured project indistinguishable from a healthy one, which is
 * exactly the ambiguity that made a sign-in failure hard to place. This issues
 * one cheap, bounded, unauthenticated request against the REST root: it needs
 * no table, returns no data, and cannot leak anything.
 */
async function probeSupabase(): Promise<SupabaseReachability> {
  const environment = getServerEnvironment();
  if (!environment.supabaseUrl || !environment.supabaseAnonKey) return "not-configured";
  try {
    // /auth/v1/settings is the one endpoint that discriminates: it answers 200
    // for a key belonging to this project and 401 for one that does not, so a
    // URL rotated without its matching key is visible rather than silent.
    const response = await fetch(`${environment.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: environment.supabaseAnonKey },
      signal: AbortSignal.timeout(4000),
      cache: "no-store"
    });
    if (response.ok) return "reachable";
    return response.status === 401 || response.status === 403 ? "key-rejected" : "reachable";
  } catch {
    // DNS failure, TLS failure or timeout: nothing answered.
    return "unreachable";
  }
}

export async function GET() {
  return NextResponse.json(
    buildHealthPayload(getServerEnvironment(), new Date(), await probeSupabase()),
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
