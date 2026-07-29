import { NextResponse, type NextRequest } from "next/server";
import {
  consumeMetaOauthState,
  liveMetaReadiness
} from "@/src/modules/integrations/meta/connection-service";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
export async function GET(request: NextRequest) {
  try {
    const channel = request.nextUrl.searchParams.get("channel");
    if (channel !== "whatsapp" && channel !== "instagram") throw new Error();
    const { workspace } = await createMetaRuntime();
    const state = request.nextUrl.searchParams.get("state") ?? "";
    if (!(await consumeMetaOauthState(state, workspace.id, channel)))
      return NextResponse.json({ error: "INVALID_OAUTH_STATE" }, { status: 400 });
    const readiness = liveMetaReadiness();
    if (!readiness.ready) return NextResponse.json(readiness, { status: 409 });
    return NextResponse.json({ status: "META_TOKEN_EXCHANGE_ADAPTER_REQUIRED" }, { status: 501 });
  } catch {
    return NextResponse.json({ error: "OAUTH_CALLBACK_FAILED" }, { status: 400 });
  }
}
