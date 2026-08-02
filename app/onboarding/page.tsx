import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { getRequestPreferences } from "@/src/lib/i18n/server";
import { OnboardingForm } from "@/src/modules/workspaces/ui/onboarding-form";
export const dynamic = "force-dynamic";
export default async function OnboardingPage() {
  const client = await createSupabaseServerClient();
  const [{ data }, { t }] = await Promise.all([
    client
      .from("onboarding_states")
      .select("current_step,completed_steps,skipped_steps,stage_data,last_saved_at")
      .maybeSingle(),
    getRequestPreferences()
  ]);
  return (
    <main className="onboarding-page">
      <section className="onboarding-intro">
        <span className="eyebrow">{t("onboarding.eyebrow")}</span>
        <h1>{t("onboarding.title")}</h1>
        <p>{t("onboarding.subtitle")}</p>
        <span className="environment-chip">{t("onboarding.sandbox")}</span>
      </section>
      <OnboardingForm
        initialStage={data?.current_step ?? "welcome"}
        initialCompleted={data?.completed_steps ?? []}
        initialSkipped={data?.skipped_steps ?? []}
        initialData={(data?.stage_data as Record<string, Record<string, string>>) ?? {}}
        initialLastSavedAt={data?.last_saved_at ?? undefined}
      />
    </main>
  );
}
