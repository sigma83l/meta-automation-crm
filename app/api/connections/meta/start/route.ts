import { NextResponse, type NextRequest } from "next/server";
import { getServerEnvironment } from "@/src/lib/env";
import { requireCsrf } from "@/src/modules/auth/security/route";
import {
  createMetaOauthState,
  liveMetaReadiness
} from "@/src/modules/integrations/meta/connection-service";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
import { assertWorkspaceManager } from "@/src/modules/workspaces/server/resolve-workspace";
export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = await request.json();
    if (body.channel !== "whatsapp" && body.channel !== "instagram") throw new Error();
    const { workspace } = await createMetaRuntime();
    assertWorkspaceManager(workspace);
    const readiness = liveMetaReadiness();
    if (!readiness.ready) return NextResponse.json(readiness, { status: 409 });
    const environment = getServerEnvironment();
    const state = await createMetaOauthState(workspace.id, body.channel);
    if (body.channel === "whatsapp") {
      return NextResponse.json({
        state,
        status: "AWAITING_EMBEDDED_SIGNUP",
        embeddedSignup: {
          appId: environment.metaAppId,
          configId: environment.metaWhatsappConfigId,
          responseType: "code",
          overrideDefaultResponseType: true
        }
      });
    }
    const authorization = new URL("https://www.instagram.com/oauth/authorize");
    authorization.search = new URLSearchParams({
      enable_fb_login: "0",
      force_authentication: "1",
      client_id: environment.metaAppId!,
      redirect_uri: environment.metaOauthRedirectUrl!,
      response_type: "code",
      scope: "instagram_business_basic,instagram_business_manage_messages",
      state
    }).toString();
    return NextResponse.json({
      state,
      status: "AWAITING_META_AUTHORIZATION",
      authorizationUrl: authorization.toString()
    });
  } catch {
    return NextResponse.json({ error: "OAUTH_START_FAILED" }, { status: 400 });
  }
}
