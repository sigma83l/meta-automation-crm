import { NextResponse, type NextRequest } from "next/server";
import { requireCsrf } from "@/src/modules/auth/security/route";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { createMetaRuntime } from "@/src/modules/integrations/meta/runtime";
export async function PATCH(request: NextRequest) {
  const rejected = requireCsrf(request);
  if (rejected) return rejected;
  try {
    const body = await request.json();
    if (!["takeover", "resume"].includes(body.action)) throw new Error();
    const { workspace } = await createMetaRuntime();
    const admin = createSupabaseAdminClient();
    const takeover = body.action === "takeover";
    const result = await admin
      .from("conversations")
      .update({ owner: takeover ? "human" : "automation", requires_human_review: takeover })
      .eq("workspace_id", workspace.id)
      .eq("id", String(body.conversationId))
      .select("id")
      .single();
    if (result.error) throw new Error();
    if (takeover) {
      const event = await admin.from("human_takeovers").insert({
        workspace_id: workspace.id,
        conversation_id: body.conversationId,
        actor_id: workspace.userId,
        reason: "Owner requested takeover"
      });
      if (event.error) throw new Error();
    } else {
      const event = await admin
        .from("human_takeovers")
        .update({ status: "resumed", resumed_at: new Date().toISOString() })
        .eq("workspace_id", workspace.id)
        .eq("conversation_id", body.conversationId)
        .eq("status", "active");
      if (event.error) throw new Error();
    }
    return NextResponse.json({ owner: takeover ? "human" : "automation" });
  } catch {
    return NextResponse.json({ error: "TAKEOVER_FAILED" }, { status: 400 });
  }
}
