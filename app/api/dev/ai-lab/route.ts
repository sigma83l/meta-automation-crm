import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { labRunSchema } from "@/src/modules/ai-lab/contracts";
import { devOnlyEnabled } from "@/src/modules/ai-lab/dev-only";
import { runLabTurn } from "@/src/modules/ai-lab/server/lab-runner";
import { requireCsrf } from "@/src/modules/auth/security/route";
import { resolveTrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // Before anything else, including reading the body: on a production build
  // this route is indistinguishable from one that was never written.
  if (!devOnlyEnabled()) return new NextResponse(null, { status: 404 });

  const rejected = requireCsrf(request);
  if (rejected) return rejected;

  const parsed = labRunSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_LAB_REQUEST", fields: parsed.error.issues.map((i) => i.path.join(".")) },
      { status: 400 }
    );
  }

  try {
    // The workspace comes from the session, not the request. A lab that let a
    // caller name the workspace would be a way to read another tenant's
    // approved knowledge, dev build or not.
    const workspace = await resolveTrustedWorkspace(await createSupabaseServerClient());
    const admin = await createSupabaseAdminClient();
    return NextResponse.json(await runLabTurn(admin, workspace, parsed.data));
  } catch (error) {
    // The message, not a generic string: this is a developer's own tool and the
    // reason a run failed is the only thing they need from a failure.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "LAB_RUN_FAILED" },
      { status: 400 }
    );
  }
}
