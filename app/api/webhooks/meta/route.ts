import { createHmac } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getServerEnvironment } from "@/src/lib/env";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { inngest } from "@/src/lib/inngest/client";
import { dispatchAcceptedEvents } from "@/src/modules/integrations/meta/outbox-dispatch";
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
  const suppliedSignature = request.headers.get("x-hub-signature-256");
  if (!env.metaAppSecret || !verifyMetaSignature(raw, suppliedSignature, env.metaAppSecret)) {
    // A rejected delivery is an operational event, and it used to be a silent
    // one: the route returned 401 and recorded nothing, so an inbound channel
    // that had never once worked looked exactly like an inbound channel with no
    // traffic. That cost a day of guessing at causes we could have read.
    //
    // Everything here is a property of the failure, never of the payload. No
    // body, no secret, and eight hex characters of each digest - enough to say
    // "these are different keys" or "these are the same key over different
    // bytes", and far too little to forge a signature or recover a secret.
    console.warn(
      JSON.stringify({
        at: "meta-webhook-signature-rejected",
        hasSecret: Boolean(env.metaAppSecret),
        hasSignature: suppliedSignature !== null,
        bodyBytes: raw.byteLength,
        suppliedHead: suppliedSignature?.slice(7, 15) ?? "",
        expectedHead: env.metaAppSecret
          ? createHmac("sha256", env.metaAppSecret).update(raw).digest("hex").slice(0, 8)
          : ""
      })
    );
    return NextResponse.json({ accepted: false }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return NextResponse.json({ accepted: false }, { status: 400 });
  }
  try {
    const admin = await createSupabaseAdminClient();
    const result = await ingestVerifiedMetaPayload(
      payload,
      new SupabaseMetaWebhookRepository(admin)
    );

    // Dispatched here rather than left for the relay. The event is durably
    // stored either way; sending it now removes up to a minute of latency from
    // every reply, and lets the relay run rarely instead of polling an empty
    // table every minute. Anything that fails to send stays unemitted and the
    // relay collects it.
    // `in` rather than a flag: the invalid-payload branch returns a narrower
    // object with no events, and that is what distinguishes the two.
    if ("results" in result) {
      await dispatchAcceptedEvents(admin, result.events, result.results, (event) =>
        inngest.send(event)
      );
    }

    return NextResponse.json(
      { accepted: result.acknowledged, status: result.status },
      { status: result.acknowledged ? 200 : 400 }
    );
  } catch {
    return NextResponse.json({ accepted: false, status: "unavailable" }, { status: 503 });
  }
}
