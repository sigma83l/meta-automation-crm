import { NextResponse, type NextRequest } from "next/server";

import { createCrmRuntime } from "@/src/modules/crm/runtime";
import { requireCsrf } from "@/src/modules/auth/security/route";
import { billingBlockedResponse } from "@/src/modules/billing/http";
import type { SavedViewInput } from "@/src/modules/crm/contracts";
import { featureBlockedResponse } from "@/src/modules/features/http";
import { isFeatureEnabled } from "@/src/modules/features/server/gate";

export async function GET() {
  try {
    const { repository } = await createCrmRuntime();
    return NextResponse.json({ views: await repository.savedViews() });
  } catch (error) {
    return billingBlockedResponse(error, "CRM_UNAVAILABLE", 403);
  }
}

export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = (await request.json()) as { name?: unknown; filters?: unknown };
    const { client, workspace, repository } = await createCrmRuntime();
    // Creation only. A workspace whose saved views were switched off keeps
    // reading the ones it already has - withdrawing a filter somebody built
    // their day around would be a worse answer than declining to add another.
    if (!(await isFeatureEnabled(client, workspace.id, "saved_views"))) {
      return featureBlockedResponse("saved_views");
    }
    // The filters are not trusted for being well-formed here: the repository
    // checks every value against the vocabulary it belongs to and stores them in
    // typed columns, which is what makes the definition the server's rather than
    // whatever the browser sent.
    const view = await repository.saveView({
      name: String(body.name ?? ""),
      filters: (body.filters ?? {}) as SavedViewInput["filters"]
    });
    return NextResponse.json({ view }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "SAVED_VIEW_NAME_TAKEN") {
      return NextResponse.json({ error: "SAVED_VIEW_NAME_TAKEN" }, { status: 409 });
    }
    return billingBlockedResponse(error, "INVALID_SAVED_VIEW", 400);
  }
}
