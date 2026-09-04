import { NextResponse, type NextRequest } from "next/server";
import { createBillingRuntime } from "@/src/modules/billing/runtime";
import {
  completeCardRegistration,
  consumeCardRegistrationState
} from "@/src/modules/billing/subscription-service";
import { assertWorkspaceManager } from "@/src/modules/workspaces/server/resolve-workspace";

/**
 * PayTR's hosted card-registration page redirects the browser back here
 * (GET), unlike Meta's callback which is invoked by client-side JS after an
 * OAuth popup completes — so this issues a browser redirect to the billing
 * settings page rather than returning JSON.
 */
export async function GET(request: NextRequest) {
  try {
    const { workspace } = await createBillingRuntime();
    assertWorkspaceManager(workspace);

    const state = request.nextUrl.searchParams.get("state") ?? "";
    if (!(await consumeCardRegistrationState(state, workspace.id))) {
      return NextResponse.redirect(new URL("/settings/billing?status=invalid_state", request.url));
    }

    const query: Record<string, string> = {};
    request.nextUrl.searchParams.forEach((value, key) => {
      query[key] = value;
    });
    const userIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
    const outcome = await completeCardRegistration(
      workspace,
      { rawBody: new Uint8Array(), query },
      userIp
    );
    return NextResponse.redirect(
      new URL(`/settings/billing?status=${outcome.outcome}`, request.url)
    );
  } catch (error) {
    // Logged, not swallowed. This catch turns every failure into one
    // indistinguishable `status=error` in the browser, and for as long as it
    // also discarded the cause, the server had nothing to say either - a
    // registration that could never succeed looked identical to a declined
    // card. The message only: a provider error body can echo the request.
    console.error("BILLING_CALLBACK_FAILED", {
      cause: error instanceof Error ? error.message : "unknown"
    });
    return NextResponse.redirect(new URL("/settings/billing?status=error", request.url));
  }
}
