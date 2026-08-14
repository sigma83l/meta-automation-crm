import { NextResponse, type NextRequest } from "next/server";
import { getServerEnvironment } from "@/src/lib/env";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { resolvePaymentProvider } from "@/src/modules/billing/subscription-service";
import {
  SupabaseBillingWebhookRepository,
  ingestVerifiedBillingWebhook
} from "@/src/modules/billing/webhook-ingestion";
import {
  BILLING_ACKNOWLEDGEMENT_BODY,
  allowsProviderWebhook
} from "@/src/modules/billing/webhook-policy";

/**
 * PayTR's notification hash lives inside the form body itself (unlike
 * Meta's x-hub-signature-256 header), so the raw bytes are still read and
 * handed to the adapter whole; verifyAndParseWebhook does its own untyped
 * field split before checking the HMAC, and no field is treated as trusted
 * until that check passes — same "verify before you act on it" property as
 * the Meta webhook route, adapted to PayTR's payload shape.
 */
export async function POST(request: NextRequest) {
  const raw = new Uint8Array(await request.arrayBuffer());
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  try {
    const provider = resolvePaymentProvider();

    if (!allowsProviderWebhook(provider.providerName, getServerEnvironment().deploymentMode)) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const admin = await createSupabaseAdminClient();
    const result = await ingestVerifiedBillingWebhook(
      provider,
      { rawBody: raw, headers },
      new SupabaseBillingWebhookRepository(admin, provider.providerName)
    );

    // PayTR treats any response body other than the literal "OK" as a failed
    // notification and keeps retrying, so acknowledgement must be exactly this
    // and must only follow a successful persist. A rejected payload
    // deliberately does NOT acknowledge.
    return result.acknowledged
      ? new NextResponse(BILLING_ACKNOWLEDGEMENT_BODY, {
          status: 200,
          headers: { "content-type": "text/plain" }
        })
      : new NextResponse("Rejected", {
          status: 400,
          headers: { "content-type": "text/plain" }
        });
  } catch {
    // Distinct from a rejected payload: we could not establish whether the
    // notification was persisted, so we do not acknowledge and PayTR retries.
    return new NextResponse("Unavailable", {
      status: 503,
      headers: { "content-type": "text/plain" }
    });
  }
}
