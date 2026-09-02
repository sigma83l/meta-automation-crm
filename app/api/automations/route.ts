import { NextResponse, type NextRequest } from "next/server";
import { requireCsrf } from "@/src/modules/auth/security/route";
import { createAutomation } from "@/src/modules/automations/service";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
import { billingBlockedResponse } from "@/src/modules/billing/http";
import { featureBlockedResponse } from "@/src/modules/features/http";
import { isFeatureEnabled } from "@/src/modules/features/server/gate";
export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = await request.json();
    const { client, workspace } = await createMetaRuntime();
    if (!(await isFeatureEnabled(client, workspace.id, "automations"))) {
      return featureBlockedResponse("automations");
    }
    return NextResponse.json(
      await createAutomation(workspace, {
        name: String(body.name ?? ""),
        recipe: body.recipe,
        requestId: String(body.requestId ?? ""),
        configuration: body.configuration
      }),
      { status: 201 }
    );
  } catch (error) {
    return billingBlockedResponse(error, "AUTOMATION_CREATE_FAILED", 400);
  }
}
