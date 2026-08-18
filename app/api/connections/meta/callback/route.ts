import { NextResponse, type NextRequest } from "next/server";
import {
  consumeMetaOauthState,
  createLiveMetaConnection,
  liveMetaReadiness
} from "@/src/modules/integrations/meta/connection-service";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
import { assertWorkspaceManager } from "@/src/modules/workspaces/server/resolve-workspace";
import { billingBlockedResponse } from "@/src/modules/billing/http";
import { channelFromMetaOauthState } from "@/src/modules/integrations/meta/oauth-state";

/**
 * The OAuth return path for both channels, which arrive here very differently.
 *
 * Instagram sends the browser here as a redirect, so the URL carries only what
 * Meta chose to put on it — `code` and `state`, and nothing else. In particular
 * there is no `channel`, and there cannot be: the redirect URI has to match the
 * one registered byte for byte, so we cannot decorate it with our own query
 * parameters. The channel is therefore read out of the state, which is signed
 * and already contains it; reading it before verification is safe because the
 * verification that follows is what makes it authentic.
 *
 * WhatsApp arrives as a `fetch` from the browser after the Embedded Signup
 * dialog hands the code back through the JS SDK. That caller wants JSON, so it
 * asks for it with `format=json`. A browser redirect gets a redirect back to
 * /connections, because returning raw JSON to a navigation leaves the user
 * looking at a page of braces wondering whether it worked.
 */
export async function GET(request: NextRequest) {
  const wantsJson = request.nextUrl.searchParams.get("format") === "json";

  const fail = (code: string, status = 400) =>
    wantsJson
      ? NextResponse.json({ error: code }, { status })
      : NextResponse.redirect(
          new URL(`/connections?connect_error=${code}`, request.nextUrl.origin)
        );

  try {
    const state = request.nextUrl.searchParams.get("state") ?? "";
    // Prefer the explicit parameter when the caller supplied one, but fall back
    // to the state so the redirect flow works at all.
    const requested = request.nextUrl.searchParams.get("channel");
    const channel =
      requested === "whatsapp" || requested === "instagram"
        ? requested
        : channelFromMetaOauthState(state);
    if (!channel) return fail("INVALID_OAUTH_STATE");

    const { workspace } = await createMetaRuntime();
    assertWorkspaceManager(workspace);

    if (!(await consumeMetaOauthState(state, workspace.id, channel))) {
      return fail("INVALID_OAUTH_STATE");
    }

    const readiness = liveMetaReadiness();
    if (!readiness.ready) {
      return wantsJson
        ? NextResponse.json(readiness, { status: 409 })
        : fail(readiness.status, 409);
    }

    const code = request.nextUrl.searchParams.get("code") ?? "";
    const connection = await createLiveMetaConnection(workspace, {
      channel,
      code,
      ...(request.nextUrl.searchParams.get("waba_id")
        ? { wabaId: request.nextUrl.searchParams.get("waba_id")! }
        : {}),
      ...(request.nextUrl.searchParams.get("phone_number_id")
        ? { phoneNumberId: request.nextUrl.searchParams.get("phone_number_id")! }
        : {})
    });

    if (!wantsJson) {
      return NextResponse.redirect(
        new URL(`/connections?connected=${channel}`, request.nextUrl.origin)
      );
    }
    return NextResponse.json({
      status: "CONNECTED",
      connection: {
        id: connection.id,
        channel: connection.channel,
        status: connection.status
      }
    });
  } catch (error) {
    if (wantsJson) return billingBlockedResponse(error, "OAUTH_CALLBACK_FAILED", 400);
    return fail("OAUTH_CALLBACK_FAILED");
  }
}
