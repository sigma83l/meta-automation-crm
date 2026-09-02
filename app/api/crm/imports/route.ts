import { NextResponse, type NextRequest } from "next/server";

import { importCrmCsv } from "@/src/modules/crm/import/import-service";
import { createCrmRuntime } from "@/src/modules/crm/runtime";
import { requireCsrf } from "@/src/modules/auth/security/route";
import { billingBlockedResponse } from "@/src/modules/billing/http";
import { featureBlockedResponse, platformBlockedResponse } from "@/src/modules/features/http";
import { isFeatureEnabled, isPlatformSwitchEnabled } from "@/src/modules/features/server/gate";

export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const { client, workspace } = await createCrmRuntime();

    // Two different questions, asked in the order they can answer "no" most
    // cheaply for the caller. The switch is about us — it is off for everybody
    // and will come back — so it answers 503. The flag is about this workspace's
    // entitlement, which retrying will not change, so it answers 403.
    if (!(await isPlatformSwitchEnabled(client, "crm_imports"))) {
      return platformBlockedResponse("crm_imports");
    }
    if (!(await isFeatureEnabled(client, workspace.id, "crm_import"))) {
      return featureBlockedResponse("crm_import");
    }

    const result = await importCrmCsv(
      workspace,
      String(body.sourceName ?? ""),
      String(body.csv ?? "")
    );
    return NextResponse.json(result, { status: result.status === "completed" ? 201 : 422 });
  } catch (error) {
    return billingBlockedResponse(error, "CRM_IMPORT_REJECTED", 400);
  }
}
