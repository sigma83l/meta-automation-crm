import { NextResponse, type NextRequest } from "next/server";
import { requireCsrf } from "@/src/modules/auth/security/route";
import { createBusinessProfileRuntime } from "@/src/modules/business-profile/runtime";
import { billingBlockedResponse } from "@/src/modules/billing/http";

export async function GET() {
  try {
    return NextResponse.json(await (await createBusinessProfileRuntime()).repository.get());
  } catch (error) {
    return billingBlockedResponse(error, "SETTINGS_UNAVAILABLE", 403);
  }
}
export async function PATCH(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const { repository } = await createBusinessProfileRuntime();
    await repository.update(await request.json());
    return NextResponse.json({ ok: true });
  } catch (error) {
    return billingBlockedResponse(error, "INVALID_SETTINGS", 400);
  }
}
