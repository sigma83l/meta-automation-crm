import { NextResponse, type NextRequest } from "next/server";
import { requireCsrf } from "@/src/modules/auth/security/route";
import { updateAutomation } from "@/src/modules/automations/service";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = await request.json();
    const actions = ["activate", "pause", "archive", "safe_test", "stop_queued"] as const;
    if (!actions.includes(body.action)) throw new Error();
    const { workspace } = await createMetaRuntime();
    return NextResponse.json(await updateAutomation(workspace, (await params).id, body.action));
  } catch {
    return NextResponse.json({ error: "AUTOMATION_ACTION_FAILED" }, { status: 400 });
  }
}
