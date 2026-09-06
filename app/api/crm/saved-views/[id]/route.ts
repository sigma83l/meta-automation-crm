import { NextResponse, type NextRequest } from "next/server";

import { createCrmRuntime } from "@/src/modules/crm/runtime";
import { requireCsrf } from "@/src/modules/auth/security/route";
import { billingBlockedResponse } from "@/src/modules/billing/http";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const { id } = await params;
    const { repository } = await createCrmRuntime();
    await repository.deleteSavedView(id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return billingBlockedResponse(error, "SAVED_VIEW_DELETE_FAILED", 400);
  }
}
