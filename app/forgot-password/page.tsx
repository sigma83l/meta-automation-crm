import { AuthForm } from "@/src/modules/auth/ui/auth-form";
import { AuthShell } from "@/src/modules/auth/ui/auth-shell";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Reset access"
      description="The response is deliberately the same whether or not an account exists."
    >
      <AuthForm
        mode="forgot-password"
        turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
      />
      <p className="auth-link">
        <a href="/login">Return to sign in</a>
      </p>
    </AuthShell>
  );
}
