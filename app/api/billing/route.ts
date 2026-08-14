import { NextResponse, type NextRequest } from "next/server";
import { requireCsrf } from "@/src/modules/auth/security/route";
import { createBillingRuntime } from "@/src/modules/billing/runtime";
import { cancelSubscription, getBillingStatus } from "@/src/modules/billing/subscription-service";

export async function GET() {
  try {
    const { workspace } = await createBillingRuntime();
    const billing = await getBillingStatus(workspace);
    return NextResponse.json({ billing });
  } catch {
    return NextResponse.json({ error: "BILLING_UNAVAILABLE" }, { status: 403 });
  }
}

export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const { workspace } = await createBillingRuntime();
    await cancelSubscription(workspace);
    return NextResponse.json({ status: "canceled" });
  } catch {
    return NextResponse.json({ error: "BILLING_CANCEL_FAILED" }, { status: 400 });
  }
}
