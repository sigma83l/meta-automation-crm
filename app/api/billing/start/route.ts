import { NextResponse, type NextRequest } from "next/server";
import { getServerEnvironment } from "@/src/lib/env";
import { requireCsrf } from "@/src/modules/auth/security/route";
import { createBillingRuntime } from "@/src/modules/billing/runtime";
import { startCardRegistration } from "@/src/modules/billing/subscription-service";

export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const { workspace } = await createBillingRuntime();
    const environment = getServerEnvironment();
    const returnUrl = new URL("/api/billing/callback", environment.appUrl).toString();
    const userIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
    const { redirectUrl, state } = await startCardRegistration(workspace, returnUrl, userIp);
    return NextResponse.json({ redirectUrl, state });
  } catch {
    return NextResponse.json({ error: "BILLING_START_FAILED" }, { status: 400 });
  }
}
