import { NextResponse, type NextRequest } from "next/server";

import { requireCsrf } from "@/src/modules/auth/security/route";
import { createCrmRuntime } from "@/src/modules/crm/runtime";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { repository } = await createCrmRuntime();
    return NextResponse.json(await repository.detail((await params).id));
  } catch {
    return NextResponse.json({ error: "CUSTOMER_NOT_FOUND" }, { status: 404 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const { repository } = await createCrmRuntime();
    const customer = await repository.update((await params).id, {
      displayName: String(body.displayName ?? ""),
      ...(body.companyName ? { companyName: String(body.companyName) } : {})
    });
    return NextResponse.json({ customer });
  } catch {
    return NextResponse.json({ error: "INVALID_CUSTOMER" }, { status: 400 });
  }
}
