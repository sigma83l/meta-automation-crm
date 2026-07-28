import { AuthForm } from "@/src/modules/auth/ui/auth-form";
import { AuthShell } from "@/src/modules/auth/ui/auth-shell";

export default function LoginPage() {
  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in"
      description="Continue to the business workspace attached to your membership."
    >
      <AuthForm mode="login" turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />
      <div className="auth-link">
        <a href="/forgot-password">Forgot password?</a> · <a href="/signup">Create account</a>
      </div>
    </AuthShell>
  );
}
