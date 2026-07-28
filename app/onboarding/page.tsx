import { OnboardingForm } from "@/src/modules/workspaces/ui/onboarding-form";

export default function OnboardingPage() {
  return (
    <main className="auth-panel" style={{ minHeight: "100vh" }}>
      <section className="auth-form-wrap">
        <span className="eyebrow">First run</span>
        <h2>Your private workspace is ready.</h2>
        <p>
          Channels remain in sandbox mode. Complete business and provider reviews in later stages.
        </p>
        <OnboardingForm />
      </section>
    </main>
  );
}
