import { NextResponse, type NextRequest } from "next/server";
import { requireCsrf } from "@/src/modules/auth/security/route";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
import { assertWorkspaceManager } from "@/src/modules/workspaces/server/resolve-workspace";
const steps = [
  "account",
  "business-profile",
  "knowledge",
  "ai-provider",
  "channels",
  "automation",
  "test",
  "activate"
];
export async function PATCH(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = await request.json();
    if (!steps.includes(body.step)) throw new Error();
    const { workspace } = await createMetaRuntime();
    assertWorkspaceManager(workspace);
    const admin = createSupabaseAdminClient();
    const existing = await admin
      .from("onboarding_states")
      .select("completed_steps")
      .eq("workspace_id", workspace.id)
      .single();
    if (existing.error) throw new Error();
    const completed = [...new Set([...(existing.data?.completed_steps ?? []), body.step])];
    const updated = await admin
      .from("onboarding_states")
      .update({
        current_step: body.step,
        completed_steps: completed,
        updated_at: new Date().toISOString()
      })
      .eq("workspace_id", workspace.id);
    if (updated.error) throw new Error();
    return NextResponse.json({ completed });
  } catch {
    return NextResponse.json({ error: "ONBOARDING_UPDATE_FAILED" }, { status: 400 });
  }
}
