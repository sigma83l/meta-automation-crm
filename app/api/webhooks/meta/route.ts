import { NextResponse, type NextRequest } from "next/server";
import { getServerEnvironment } from "@/src/lib/env";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import {
  SupabaseMetaWebhookRepository,
  ingestVerifiedMetaPayload
} from "@/src/modules/integrations/meta/webhook-ingestion";
import {
  verifyMetaChallenge,
  verifyMetaSignature
} from "@/src/modules/integrations/meta/webhook-security";

export async function GET(request: NextRequest) {
  const env = getServerEnvironment();
  const challenge = verifyMetaChallenge(
    {
      mode: request.nextUrl.searchParams.get("hub.mode"),
      token: request.nextUrl.searchParams.get("hub.verify_token"),
      challenge: request.nextUrl.searchParams.get("hub.challenge")
    },
    env.metaWebhookVerifyToken ?? ""
  );
  return challenge
    ? new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } })
    : new NextResponse("Forbidden", { status: 403 });
}
export async function POST(request: NextRequest) {
  const env = getServerEnvironment();
  const raw = new Uint8Array(await request.arrayBuffer());
  if (
    !env.metaAppSecret ||
    !verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), env.metaAppSecret)
  )
    return NextResponse.json({ accepted: false }, { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return NextResponse.json({ accepted: false }, { status: 400 });
  }
  try {
    const result = await ingestVerifiedMetaPayload(
      payload,
      new SupabaseMetaWebhookRepository(createSupabaseAdminClient())
    );
    return NextResponse.json(
      { accepted: result.acknowledged, status: result.status },
      { status: result.acknowledged ? 200 : 400 }
    );
  } catch {
    return NextResponse.json({ accepted: false, status: "unavailable" }, { status: 503 });
  }
}
