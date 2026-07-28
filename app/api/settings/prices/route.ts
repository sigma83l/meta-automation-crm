import { NextResponse, type NextRequest } from "next/server";
import { requireCsrf } from "@/src/modules/auth/security/route";
import { createBusinessProfileRuntime } from "@/src/modules/business-profile/runtime";
export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = await request.json();
    await (
      await createBusinessProfileRuntime()
    ).repository.addPrice({
      name: String(body.name ?? ""),
      description: String(body.description ?? ""),
      amountMinor: Number(body.amountMinor),
      currency: String(body.currency ?? ""),
      availability: String(body.availability ?? "ask_human")
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "INVALID_PRICE" }, { status: 400 });
  }
}
