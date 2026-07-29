import { NextResponse, type NextRequest } from "next/server";
import { requireCsrf } from "@/src/modules/auth/security/route";
import {
  createMetaOauthState,
  liveMetaReadiness
} from "@/src/modules/integrations/meta/connection-service";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = await request.json();
    if (body.channel !== "whatsapp" && body.channel !== "instagram") throw new Error();
    const { workspace } = await createMetaRuntime();
    const readiness = liveMetaReadiness();
    if (!readiness.ready) return NextResponse.json(readiness, { status: 409 });
    return NextResponse.json({
      state: await createMetaOauthState(workspace.id, body.channel),
      status: "AWAITING_META_AUTHORIZATION"
    });
  } catch {
    return NextResponse.json({ error: "OAUTH_START_FAILED" }, { status: 400 });
  }
}
