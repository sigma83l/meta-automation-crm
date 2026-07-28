import { AuthForm } from "@/src/modules/auth/ui/auth-form";
import { AuthShell } from "@/src/modules/auth/ui/auth-shell";

export default function SignupPage() {
  return (
    <AuthShell
      eyebrow="New business"
      title="Create your workspace"
      description="Your profile, workspace, ownership and defaults are created as one transaction."
    >
      <AuthForm mode="signup" turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />
      <p className="auth-link">
        Already registered? <a href="/login">Sign in</a>
      </p>
    </AuthShell>
  );
}
