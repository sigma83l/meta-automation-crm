import { NextResponse, type NextRequest } from "next/server";

import { createCrmRuntime } from "@/src/modules/crm/runtime";
import { requireCsrf } from "@/src/modules/auth/security/route";

export async function GET(request: NextRequest) {
  try {
    const { repository } = await createCrmRuntime();
    const status = request.nextUrl.searchParams.get("status");
    const customers = await repository.list({
      ...(request.nextUrl.searchParams.get("q")
        ? { query: request.nextUrl.searchParams.get("q")! }
        : {}),
      ...(status === "active" || status === "archived" ? { status } : {})
    });
    return NextResponse.json({ customers });
  } catch {
    return NextResponse.json({ error: "CRM_UNAVAILABLE" }, { status: 403 });
  }
}

export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const { repository } = await createCrmRuntime();
    const customer = await repository.create({
      displayName: String(body.displayName ?? ""),
      ...(body.companyName ? { companyName: String(body.companyName) } : {}),
      ...(body.email ? { email: String(body.email) } : {}),
      ...(body.phone ? { phone: String(body.phone) } : {})
    });
    return NextResponse.json({ customer }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "INVALID_CUSTOMER" }, { status: 400 });
  }
}
