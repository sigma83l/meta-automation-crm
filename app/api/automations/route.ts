import { NextResponse, type NextRequest } from "next/server";
import { requireCsrf } from "@/src/modules/auth/security/route";
import { createAutomation } from "@/src/modules/automations/service";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
export async function POST(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = await request.json();
    const { workspace } = await createMetaRuntime();
    return NextResponse.json(
      await createAutomation(workspace, {
        name: String(body.name ?? ""),
        recipe: body.recipe,
        requestId: String(body.requestId ?? ""),
        configuration: body.configuration
      }),
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: "AUTOMATION_CREATE_FAILED" }, { status: 400 });
  }
}
