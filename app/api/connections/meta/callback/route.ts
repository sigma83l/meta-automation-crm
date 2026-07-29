import { NextResponse, type NextRequest } from "next/server";
import {
  consumeMetaOauthState,
  createLiveMetaConnection,
  liveMetaReadiness
} from "@/src/modules/integrations/meta/connection-service";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
import { assertWorkspaceManager } from "@/src/modules/workspaces/server/resolve-workspace";
export async function GET(request: NextRequest) {
  try {
    const channel = request.nextUrl.searchParams.get("channel");
    if (channel !== "whatsapp" && channel !== "instagram") throw new Error();
    const { workspace } = await createMetaRuntime();
    assertWorkspaceManager(workspace);
    const state = request.nextUrl.searchParams.get("state") ?? "";
    if (!(await consumeMetaOauthState(state, workspace.id, channel)))
      return NextResponse.json({ error: "INVALID_OAUTH_STATE" }, { status: 400 });
    const readiness = liveMetaReadiness();
    if (!readiness.ready) return NextResponse.json(readiness, { status: 409 });
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
    return NextResponse.json({
      status: "CONNECTED",
      connection: {
        id: connection.id,
        channel: connection.channel,
        status: connection.status
      }
    });
  } catch {
    return NextResponse.json({ error: "OAUTH_CALLBACK_FAILED" }, { status: 400 });
  }
}
