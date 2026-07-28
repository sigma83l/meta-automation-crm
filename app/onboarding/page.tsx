import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { OnboardingForm } from "@/src/modules/workspaces/ui/onboarding-form";
export const dynamic = "force-dynamic";
export default async function OnboardingPage() {
  const client = await createSupabaseServerClient();
  const { data } = await client.from("onboarding_states").select("completed_steps").maybeSingle();
  return (
    <main className="onboarding-page">
      <section className="onboarding-intro">
        <span className="eyebrow">Guided setup</span>
        <h1>Start safely, then activate.</h1>
        <p>Your progress is saved. Sandbox tests never contact real customers.</p>
      </section>
      <OnboardingForm initialCompleted={data?.completed_steps ?? []} />
    </main>
  );
}
