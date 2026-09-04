import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { devOnlyEnabled } from "@/src/modules/ai-lab/dev-only";
import { loadLabDefaults } from "@/src/modules/ai-lab/server/lab-runner";
import { AiLabConsole } from "@/src/modules/ai-lab/ui/ai-lab-console";
import { resolveTrustedWorkspace } from "@/src/modules/workspaces/server/resolve-workspace";
import { WorkspaceShell } from "@/src/modules/workspaces/ui/workspace-shell";

export const dynamic = "force-dynamic";

export default async function AiLabPage() {
  if (!devOnlyEnabled()) notFound();

  // Deliberately not entitlement-gated. The lab is for working on the assistant
  // itself, and a lapsed subscription is a billing state, not a reason a
  // developer cannot see why a prompt produces the reply it produces.
  const workspace = await resolveTrustedWorkspace(await createSupabaseServerClient());
  const admin = await createSupabaseAdminClient();
  const defaults = await loadLabDefaults(admin, workspace);

  return (
    <WorkspaceShell active="automations" workspaceName={workspace.name}>
      <div className="content">
        <header className="page-intro">
          <span className="eyebrow">Local only · never served in production</span>
          <h2>AI Lab</h2>
          <p>
            Talk to the assistant without a Meta app. Prompt mode calls the model and shows what it
            said; pipeline mode runs the real turn engine and shows whether the reply would have
            been allowed out.
          </p>
        </header>
        {defaults ? (
          <AiLabConsole
            defaultContext={defaults.context}
            aiMode={defaults.aiMode}
            models={{
              utility: process.env.AI_MODEL_UTILITY ?? "",
              primary: process.env.AI_MODEL_PRIMARY ?? "",
              escalation: process.env.AI_MODEL_ESCALATION ?? ""
            }}
          />
        ) : (
          <section className="settings-card entitlement-block">
            <h2>No business profile</h2>
            <p>
              A turn answers on behalf of a business, so it needs one: language, policy and approved
              knowledge all come from the profile. Finish onboarding for this workspace first.
            </p>
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}
